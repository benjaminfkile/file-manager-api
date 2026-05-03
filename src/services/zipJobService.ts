import { createHash } from "crypto";
import { PassThrough } from "stream";
import archiver from "archiver";
import { Upload } from "@aws-sdk/lib-storage";
import { getDb } from "../db/db";
import { collectFolderFiles, getFolderById } from "./folderService";
import { getAppSecrets } from "../aws/getAppSecrets";
import {
  s3KeyExists,
  getS3Client,
  getBucketName,
  getObjectStream,
} from "../aws/s3Service";
import { IZipJob } from "../interfaces";

const ZIP_JOBS = "zip_jobs";

// ---- In-process concurrency semaphore ----

export class Semaphore {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly cap: number) {}

  acquire(): Promise<void> {
    if (this.running < this.cap) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

let sem: Semaphore | null = null;

async function getSemaphore(): Promise<Semaphore> {
  if (sem) return sem;
  const secrets = await getAppSecrets();
  const rawCap = Number(secrets.MAX_CONCURRENT_ZIPS);
  sem = new Semaphore(rawCap || 2);
  return sem;
}

/** Reset the semaphore — for tests only. */
export function _setSemaphoreCap(cap: number): void {
  sem = new Semaphore(cap);
}

// ---- Public API ----

/**
 * Computes a deterministic SHA-256 fingerprint of a folder's current content.
 * Includes each file's s3_key and updated_at so the hash reflects both the
 * set of files and the last time any was modified.
 */
export async function computeFolderHash(folderId: string): Promise<string> {
  const db = getDb();

  const folderRows = await db.raw<{ rows: { id: string }[] }>(
    `WITH RECURSIVE tree AS (
       SELECT id FROM folders WHERE id = ? AND is_deleted = false
       UNION ALL
       SELECT f.id FROM folders f JOIN tree t ON f.parent_folder_id = t.id WHERE f.is_deleted = false
     )
     SELECT id FROM tree`,
    [folderId]
  );

  const folderIds = folderRows.rows.map((r) => r.id);
  if (folderIds.length === 0) {
    return createHash("sha256").update("[]").digest("hex");
  }

  const files = await db("files")
    .whereIn("folder_id", folderIds)
    .where({ is_deleted: false })
    .select("s3_key", "updated_at")
    .orderBy("s3_key");

  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

/**
 * Returns an existing ready zip job (from S3 cache) or creates a new pending
 * job and kicks off runZipJob in the background.
 */
export async function getOrCreateZipJob(
  userId: string,
  folderId: string
): Promise<IZipJob> {
  const hash = await computeFolderHash(folderId);
  const s3Key = `zip-cache/${userId}/${hash}.zip`;

  const exists = await s3KeyExists(s3Key);
  if (exists) {
    const now = new Date().toISOString();
    return {
      id: `cache-${hash}`,
      user_id: userId,
      folder_id: folderId,
      zip_hash: hash,
      s3_key: s3Key,
      status: "ready",
      error: null,
      created_at: now,
      completed_at: now,
    };
  }

  const db = getDb();
  const [job]: IZipJob[] = await db(ZIP_JOBS)
    .insert({
      user_id: userId,
      folder_id: folderId,
      zip_hash: hash,
      s3_key: s3Key,
      status: "pending",
    })
    .returning("*");

  runZipJob(job.id).catch((err) => {
    console.error(`[zipJob] Unhandled error for job ${job.id}:`, err);
  });

  return job;
}

/**
 * Executes the zip job: streams all folder files through archiver into S3
 * using lib-storage Upload (store-only compression, ContentDisposition baked in).
 * Acquires a semaphore slot before starting so excess calls are queued.
 */
export async function runZipJob(jobId: string): Promise<void> {
  const semaphore = await getSemaphore();
  await semaphore.acquire();

  const db = getDb();

  try {
    await db(ZIP_JOBS).where({ id: jobId }).update({ status: "running" });

    const job: IZipJob | undefined = await db(ZIP_JOBS)
      .where({ id: jobId })
      .first();
    if (!job) throw new Error(`Zip job ${jobId} not found`);

    const folder = await getFolderById(job.folder_id);
    const folderName = folder?.name ?? "download";

    const files = await collectFolderFiles(job.folder_id);

    const pass = new PassThrough();
    const archive = archiver("zip", { zlib: { level: 0 } });
    archive.pipe(pass);

    const upload = new Upload({
      client: getS3Client(),
      params: {
        Bucket: getBucketName(),
        Key: job.s3_key,
        Body: pass,
        ContentType: "application/zip",
        ContentDisposition: `attachment; filename="${folderName}.zip"`,
      },
    });

    for (const { s3_key, zipPath } of files) {
      const stream = await getObjectStream(s3_key);
      archive.append(stream, { name: zipPath });
    }

    await archive.finalize();
    await upload.done();

    await db(ZIP_JOBS)
      .where({ id: jobId })
      .update({ status: "ready", completed_at: db.fn.now() });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db(ZIP_JOBS)
      .where({ id: jobId })
      .update({ status: "failed", error: errorMsg });
  } finally {
    semaphore.release();
  }
}

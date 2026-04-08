import { getDb } from "../db/db";
import { IFile } from "../interfaces";

const FILES = "files";

/** Create a new file record. */
export async function createFileRecord(
  userId: string,
  folderId: string | null,
  name: string,
  s3Key: string,
  sizeBytes: number,
  mimeType: string
): Promise<IFile> {
  const db = getDb();
  const [file] = await db(FILES)
    .insert({
      user_id: userId,
      folder_id: folderId,
      name,
      s3_key: s3Key,
      size_bytes: sizeBytes,
      mime_type: mimeType,
    })
    .returning("*");
  return file;
}

/** Fetch a single file by its id (non-deleted only). */
export async function getFileById(fileId: string): Promise<IFile | null> {
  const db = getDb();
  const file = await db(FILES)
    .where({ id: fileId, is_deleted: false })
    .first();
  return file ?? null;
}

/** List all non-deleted files in a folder for a given user. */
export async function listFilesInFolder(
  folderId: string,
  userId: string
): Promise<IFile[]> {
  const db = getDb();
  return db(FILES)
    .where({ folder_id: folderId, user_id: userId, is_deleted: false })
    .orderBy("name", "asc");
}

/** Rename a file. */
export async function renameFile(
  fileId: string,
  name: string
): Promise<IFile> {
  const db = getDb();
  const [file] = await db(FILES)
    .where({ id: fileId })
    .update({ name, updated_at: db.fn.now() })
    .returning("*");
  return file;
}

/** Soft-delete a file. */
export async function softDeleteFile(fileId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db(FILES)
    .where({ id: fileId })
    .update({ is_deleted: true, deleted_at: now, updated_at: now });
}

/** Restore a soft-deleted file. */
export async function restoreFile(fileId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db(FILES)
    .where({ id: fileId })
    .update({ is_deleted: false, deleted_at: null, updated_at: now });
}

/**
 * Permanently delete a file from the database and S3.
 * `s3DeleteFn` receives the S3 key to remove.
 */
export async function hardDeleteFile(
  fileId: string,
  s3DeleteFn: (s3Key: string) => Promise<void>
): Promise<void> {
  const db = getDb();
  const file: Pick<IFile, "s3_key"> | undefined = await db(FILES)
    .where({ id: fileId })
    .select("s3_key")
    .first();

  if (!file) return;

  await db(FILES).where({ id: fileId }).del();
  await s3DeleteFn(file.s3_key);
}

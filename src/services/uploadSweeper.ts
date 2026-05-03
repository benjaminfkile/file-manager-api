import { getDb } from "../db/db";
import { abortMultipartUpload } from "../aws/s3Service";
import { deleteUploadSession } from "./fileService";

const UPLOAD_SESSIONS = "upload_sessions";
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const ABANDON_AGE = "48 hours";

let timer: NodeJS.Timeout | null = null;

interface AbandonedSession {
  id: string;
  s3_key: string;
  s3_upload_id: string;
}

/**
 * Finds upload_sessions older than 48 hours, aborts each S3 multipart upload
 * (best-effort — S3 errors are swallowed and logged), and removes the row.
 * Returns the number of sessions swept.
 */
export async function sweepAbandonedUploadSessions(): Promise<number> {
  const db = getDb();

  const sessions: AbandonedSession[] = await db(UPLOAD_SESSIONS)
    .select("id", "s3_key", "s3_upload_id")
    .whereRaw(`created_at < NOW() - INTERVAL '${ABANDON_AGE}'`);

  for (const session of sessions) {
    try {
      await abortMultipartUpload(session.s3_key, session.s3_upload_id);
    } catch (err) {
      console.warn(
        `[uploadSweeper] abortMultipartUpload failed for session ${session.id}:`,
        (err as Error).message
      );
    }
    await deleteUploadSession(session.id);
  }

  console.log(`[uploadSweeper] swept ${sessions.length} abandoned upload session(s)`);
  return sessions.length;
}

/**
 * Starts the periodic sweeper. Runs once immediately, then every hour.
 * No-op if already started or if `process.env.DISABLE_UPLOAD_SWEEPER === "true"`,
 * which lets tests skip the interval.
 */
export function startUploadSweeper(): void {
  if (process.env.DISABLE_UPLOAD_SWEEPER === "true") return;
  if (timer) return;

  sweepAbandonedUploadSessions().catch((err) => {
    console.error("[uploadSweeper] initial sweep failed:", err);
  });

  timer = setInterval(() => {
    sweepAbandonedUploadSessions().catch((err) => {
      console.error("[uploadSweeper] scheduled sweep failed:", err);
    });
  }, SWEEP_INTERVAL_MS);
}

/** Stops the sweeper interval. Used for tests / graceful shutdown. */
export function stopUploadSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

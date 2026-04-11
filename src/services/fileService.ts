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

/** List top-level soft-deleted files for a user (files whose folder is NULL or non-deleted). */
export async function listDeletedFiles(userId: string): Promise<IFile[]> {
  const db = getDb();
  return db(FILES)
    .where({ user_id: userId, is_deleted: true })
    .andWhere(function () {
      this.whereNull("folder_id").orWhereIn(
        "folder_id",
        db("folders").select("id").where({ is_deleted: false })
      );
    })
    .orderBy("deleted_at", "desc");
}

/** Fetch a single soft-deleted file by its id. */
export async function getDeletedFileById(fileId: string): Promise<IFile | null> {
  const db = getDb();
  const file = await db(FILES)
    .where({ id: fileId, is_deleted: true })
    .first();
  return file ?? null;
}

/** List all non-deleted root-level files for a user (folder_id IS NULL). */
export async function listRootFiles(userId: string): Promise<IFile[]> {
  const db = getDb();
  return db(FILES)
    .where({ user_id: userId, is_deleted: false })
    .whereNull("folder_id")
    .orderBy("name", "asc");
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

/** Restore a soft-deleted file. Throws if the parent folder is also soft-deleted. */
export async function restoreFile(fileId: string): Promise<void> {
  const db = getDb();

  const file = await db(FILES).where({ id: fileId }).select("folder_id").first();
  if (file?.folder_id) {
    const deletedParent = await db("folders")
      .where({ id: file.folder_id, is_deleted: true })
      .first();
    if (deletedParent) {
      throw new Error(
        "The parent folder is also in the recycle bin. Restore the parent folder first."
      );
    }
  }

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

  await s3DeleteFn(file.s3_key);
  await db(FILES).where({ id: fileId }).del();
}

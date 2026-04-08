import { getDb } from "../db/db";
import { IFolder, IFile } from "../interfaces";

const FOLDERS = "folders";
const FILES = "files";

/** Create a new folder, optionally nested under a parent. */
export async function createFolder(
  userId: string,
  name: string,
  parentFolderId?: string
): Promise<IFolder> {
  const db = getDb();
  const [folder] = await db(FOLDERS)
    .insert({
      user_id: userId,
      name,
      parent_folder_id: parentFolderId ?? null,
    })
    .returning("*");
  return folder;
}

/** Fetch a single folder by its id (non-deleted only). */
export async function getFolderById(
  folderId: string
): Promise<IFolder | null> {
  const db = getDb();
  const folder = await db(FOLDERS)
    .where({ id: folderId, is_deleted: false })
    .first();
  return folder ?? null;
}

/** List a user's root-level folders (no parent, non-deleted). */
export async function listRootFolders(userId: string): Promise<IFolder[]> {
  const db = getDb();
  return db(FOLDERS)
    .where({ user_id: userId, parent_folder_id: null, is_deleted: false })
    .orderBy("name", "asc");
}

/** List the immediate child folders and files inside a folder. */
export async function listFolderContents(
  folderId: string,
  userId: string
): Promise<{ folders: IFolder[]; files: IFile[] }> {
  const db = getDb();
  const [folders, files] = await Promise.all([
    db(FOLDERS)
      .where({ parent_folder_id: folderId, user_id: userId, is_deleted: false })
      .orderBy("name", "asc"),
    db(FILES)
      .where({ folder_id: folderId, user_id: userId, is_deleted: false })
      .orderBy("name", "asc"),
  ]);
  return { folders, files };
}

/** Rename a folder. */
export async function renameFolder(
  folderId: string,
  name: string
): Promise<IFolder> {
  const db = getDb();
  const [folder] = await db(FOLDERS)
    .where({ id: folderId })
    .update({ name, updated_at: db.fn.now() })
    .returning("*");
  return folder;
}

// ---------------------------------------------------------------------------
// Recursive helpers
// ---------------------------------------------------------------------------

/** Collect all descendant folder ids (including the given root id). */
async function collectDescendantIds(rootId: string): Promise<string[]> {
  const db = getDb();
  const result = await db.raw<{ rows: { id: string }[] }>(
    `WITH RECURSIVE tree AS (
       SELECT id FROM folders WHERE id = ?
       UNION ALL
       SELECT f.id FROM folders f INNER JOIN tree t ON f.parent_folder_id = t.id
     )
     SELECT id FROM tree`,
    [rootId]
  );
  return result.rows.map((r) => r.id);
}

/** Soft-delete a folder and all its descendants (folders + files). */
export async function softDeleteFolder(folderId: string): Promise<void> {
  const db = getDb();
  const ids = await collectDescendantIds(folderId);
  const now = new Date().toISOString();

  await db.transaction(async (trx) => {
    await trx(FOLDERS)
      .whereIn("id", ids)
      .update({ is_deleted: true, deleted_at: now, updated_at: now });
    await trx(FILES)
      .whereIn("folder_id", ids)
      .update({ is_deleted: true, deleted_at: now, updated_at: now });
  });
}

/** Restore a soft-deleted folder and all its descendants (folders + files). */
export async function restoreFolder(folderId: string): Promise<void> {
  const db = getDb();
  const ids = await collectDescendantIds(folderId);
  const now = new Date().toISOString();

  await db.transaction(async (trx) => {
    await trx(FOLDERS)
      .whereIn("id", ids)
      .update({ is_deleted: false, deleted_at: null, updated_at: now });
    await trx(FILES)
      .whereIn("folder_id", ids)
      .update({ is_deleted: false, deleted_at: null, updated_at: now });
  });
}

/**
 * Permanently delete a folder tree from the database and S3.
 * `s3DeleteFn` receives an array of S3 keys to remove.
 */
export async function hardDeleteFolder(
  folderId: string,
  s3DeleteFn: (s3Keys: string[]) => Promise<void>
): Promise<void> {
  const db = getDb();
  const ids = await collectDescendantIds(folderId);

  // Gather S3 keys for every file in the tree before deleting rows.
  const files: Pick<IFile, "s3_key">[] = await db(FILES)
    .whereIn("folder_id", ids)
    .select("s3_key");

  const s3Keys = files.map((f) => f.s3_key);

  await db.transaction(async (trx) => {
    // Delete files first (child FK), then folders.
    await trx(FILES).whereIn("folder_id", ids).del();
    await trx(FOLDERS).whereIn("id", ids).del();
  });

  if (s3Keys.length > 0) {
    await s3DeleteFn(s3Keys);
  }
}

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

/** List top-level soft-deleted folders for a user (parent is NULL or non-deleted). */
export async function listDeletedFolders(userId: string): Promise<IFolder[]> {
  const db = getDb();
  return db(FOLDERS)
    .where({ user_id: userId, is_deleted: true })
    .andWhere(function () {
      this.whereNull("parent_folder_id").orWhereIn(
        "parent_folder_id",
        db(FOLDERS).select("id").where({ is_deleted: false })
      );
    })
    .orderBy("deleted_at", "desc");
}

/** Fetch a single soft-deleted folder by its id. */
export async function getDeletedFolderById(
  folderId: string
): Promise<IFolder | null> {
  const db = getDb();
  const folder = await db(FOLDERS)
    .where({ id: folderId, is_deleted: true })
    .first();
  return folder ?? null;
}

/** List a user's root-level folders (no parent, non-deleted) plus folders shared with them at root level. */
export async function listRootFolders(userId: string): Promise<IFolder[]> {
  const db = getDb();
  const [owned, shared] = await Promise.all([
    db(FOLDERS)
      .where({ user_id: userId, parent_folder_id: null, is_deleted: false })
      .orderBy("name", "asc"),
    db(FOLDERS)
      .join("folder_shares", "folders.id", "folder_shares.folder_id")
      .where({
        "folder_shares.shared_with_user_id": userId,
        "folders.parent_folder_id": null,
        "folders.is_deleted": false,
      })
      .select("folders.*")
      .orderBy("folders.name", "asc"),
  ]);

  // Merge, deduplicate by id, and sort by name
  const map = new Map<string, IFolder>();
  for (const f of owned) map.set(f.id, f);
  for (const f of shared) if (!map.has(f.id)) map.set(f.id, f);
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** List the immediate non-deleted child folders and files inside a folder. */
export async function listFolderContents(
  folderId: string
): Promise<{ subFolders: IFolder[]; files: IFile[] }> {
  const db = getDb();
  const [subFolders, files] = await Promise.all([
    db(FOLDERS)
      .where({ parent_folder_id: folderId, is_deleted: false })
      .orderBy("name", "asc"),
    db(FILES)
      .where({ folder_id: folderId, is_deleted: false })
      .orderBy("name", "asc"),
  ]);
  return { subFolders, files };
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
 * Collect all non-deleted files in a folder tree with their relative zip paths.
 * Returns an array of { s3_key, zipPath } where zipPath preserves directory structure.
 */
export async function collectFolderFiles(
  rootId: string
): Promise<{ s3_key: string; zipPath: string }[]> {
  const db = getDb();

  // Get all descendant folder ids (non-deleted only)
  const folderRows = await db.raw<{
    rows: { id: string; name: string; parent_folder_id: string | null }[];
  }>(
    `WITH RECURSIVE tree AS (
       SELECT id, name, parent_folder_id FROM folders WHERE id = ? AND is_deleted = false
       UNION ALL
       SELECT f.id, f.name, f.parent_folder_id FROM folders f INNER JOIN tree t ON f.parent_folder_id = t.id WHERE f.is_deleted = false
     )
     SELECT id, name, parent_folder_id FROM tree`,
    [rootId]
  );

  const folders = folderRows.rows;
  if (folders.length === 0) return [];

  // Build a map of folder id -> folder for path resolution
  const folderMap = new Map(folders.map((f) => [f.id, f]));

  // Build relative path for each folder
  const pathCache = new Map<string, string>();
  function getFolderPath(folderId: string): string {
    if (pathCache.has(folderId)) return pathCache.get(folderId)!;
    const folder = folderMap.get(folderId);
    if (!folder) return "";
    if (folder.id === rootId) {
      pathCache.set(folderId, "");
      return "";
    }
    const parentPath = getFolderPath(folder.parent_folder_id!);
    const path = parentPath ? `${parentPath}/${folder.name}` : folder.name;
    pathCache.set(folderId, path);
    return path;
  }

  const folderIds = folders.map((f) => f.id);

  // Get all non-deleted files in these folders
  const files: Pick<IFile, "s3_key" | "name" | "folder_id">[] = await db(FILES)
    .whereIn("folder_id", folderIds)
    .where({ is_deleted: false })
    .select("s3_key", "name", "folder_id");

  return files.map((f) => {
    const folderPath = getFolderPath(f.folder_id!);
    const zipPath = folderPath ? `${folderPath}/${f.name}` : f.name;
    return { s3_key: f.s3_key, zipPath };
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

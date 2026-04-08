import { getDb } from "../db/db";

/**
 * Returns true if the user owns the folder OR has a folder_shares record for it.
 */
export async function canAccessFolder(
  userId: string,
  folderId: string
): Promise<boolean> {
  const db = getDb();

  const folder = await db("folders")
    .where({ id: folderId, is_deleted: false })
    .first();

  if (!folder) return false;

  // Owner check
  if (folder.user_id === userId) return true;

  // Shared check
  const share = await db("folder_shares")
    .where({ folder_id: folderId, shared_with_user_id: userId })
    .first();

  return !!share;
}

/**
 * Returns true if the user owns the file, has a file_shares record,
 * or has access to the file's parent folder via folder_shares.
 */
export async function canAccessFile(
  userId: string,
  fileId: string
): Promise<boolean> {
  const db = getDb();

  const file = await db("files")
    .where({ id: fileId, is_deleted: false })
    .first();

  if (!file) return false;

  // Owner check
  if (file.user_id === userId) return true;

  // Direct file share check
  const fileShare = await db("file_shares")
    .where({ file_id: fileId, shared_with_user_id: userId })
    .first();

  if (fileShare) return true;

  // Shared parent folder check
  if (file.folder_id) {
    return canAccessFolder(userId, file.folder_id);
  }

  return false;
}

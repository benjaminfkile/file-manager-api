import { getDb } from "../db/db";
import { IFolder } from "../interfaces";

/**
 * Returns true if the user owns the folder, has a folder_shares record,
 * or any ancestor folder is shared with the user (walks up the folder tree).
 */
export async function canAccessFolder(
  userId: string,
  folderId: string
): Promise<boolean> {
  const db = getDb();

  const folder = await db<IFolder>("folders")
    .where({ id: folderId, is_deleted: false })
    .first();

  if (!folder) return false;

  // Owner check
  if (folder.user_id === userId) return true;

  // Walk up the folder tree checking for folder_shares at each level
  let currentFolder: IFolder | undefined = folder;

  while (currentFolder) {
    const share = await db("folder_shares")
      .where({ folder_id: currentFolder.id, shared_with_user_id: userId })
      .first();

    if (share) return true;

    // Move to the parent folder
    if (!currentFolder.parent_folder_id) break;

    currentFolder = await db<IFolder>("folders")
      .where({ id: currentFolder.parent_folder_id, is_deleted: false })
      .first();
  }

  return false;
}

/**
 * Returns true if the user owns the file, has a file_shares record,
 * or the file is in a folder shared with the user (walks up the folder tree).
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

  // Check if the file's folder (or any ancestor) is shared with the user
  if (file.folder_id) {
    return canAccessFolder(userId, file.folder_id);
  }

  return false;
}

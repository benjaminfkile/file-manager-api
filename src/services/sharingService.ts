import { getDb } from "../db/db";
import { IFile, IFileShare, IFolder, IFolderShare } from "../interfaces";

const FILE_SHARES = "file_shares";
const FOLDER_SHARES = "folder_shares";
const FILES = "files";
const FOLDERS = "folders";
const USERS = "users";

/** Share a file with another user by username. */
export async function shareFile(
  fileId: string,
  ownerUserId: string,
  shareWithUsername: string
): Promise<IFileShare> {
  const db = getDb();
  const targetUser = await db(USERS)
    .where({ username: shareWithUsername })
    .first();

  if (!targetUser) {
    throw new Error(`User "${shareWithUsername}" not found`);
  }

  if (targetUser.id === ownerUserId) {
    throw new Error("Cannot share a file with yourself");
  }

  const [share] = await db(FILE_SHARES)
    .insert({
      file_id: fileId,
      owner_user_id: ownerUserId,
      shared_with_user_id: targetUser.id,
    })
    .returning("*");
  return share;
}

/** Remove a file share. */
export async function unshareFile(
  fileId: string,
  ownerUserId: string,
  sharedWithUserId: string
): Promise<void> {
  const db = getDb();
  const deleted = await db(FILE_SHARES)
    .where({
      file_id: fileId,
      owner_user_id: ownerUserId,
      shared_with_user_id: sharedWithUserId,
    })
    .del();

  if (deleted === 0) {
    throw new Error("File share not found");
  }
}

/** Get all shares for a file. */
export async function getFileShares(fileId: string): Promise<IFileShare[]> {
  const db = getDb();
  return db(FILE_SHARES).where({ file_id: fileId }).orderBy("created_at", "asc");
}

/** Share a folder with another user by username. */
export async function shareFolder(
  folderId: string,
  ownerUserId: string,
  shareWithUsername: string
): Promise<IFolderShare> {
  const db = getDb();
  const targetUser = await db(USERS)
    .where({ username: shareWithUsername })
    .first();

  if (!targetUser) {
    throw new Error(`User "${shareWithUsername}" not found`);
  }

  if (targetUser.id === ownerUserId) {
    throw new Error("Cannot share a folder with yourself");
  }

  const [share] = await db(FOLDER_SHARES)
    .insert({
      folder_id: folderId,
      owner_user_id: ownerUserId,
      shared_with_user_id: targetUser.id,
    })
    .returning("*");
  return share;
}

/** Remove a folder share. */
export async function unshareFolder(
  folderId: string,
  ownerUserId: string,
  sharedWithUserId: string
): Promise<void> {
  const db = getDb();
  const deleted = await db(FOLDER_SHARES)
    .where({
      folder_id: folderId,
      owner_user_id: ownerUserId,
      shared_with_user_id: sharedWithUserId,
    })
    .del();

  if (deleted === 0) {
    throw new Error("Folder share not found");
  }
}

/** Get all shares for a folder. */
export async function getFolderShares(folderId: string): Promise<IFolderShare[]> {
  const db = getDb();
  return db(FOLDER_SHARES).where({ folder_id: folderId }).orderBy("created_at", "asc");
}

/** Get all files and folders shared with a user. */
export async function getItemsSharedWithUser(
  userId: string
): Promise<{ files: IFile[]; folders: IFolder[] }> {
  const db = getDb();

  const files: IFile[] = await db(FILES)
    .join(FILE_SHARES, `${FILES}.id`, `${FILE_SHARES}.file_id`)
    .where(`${FILE_SHARES}.shared_with_user_id`, userId)
    .andWhere(`${FILES}.is_deleted`, false)
    .select(`${FILES}.*`);

  const folders: IFolder[] = await db(FOLDERS)
    .join(FOLDER_SHARES, `${FOLDERS}.id`, `${FOLDER_SHARES}.folder_id`)
    .where(`${FOLDER_SHARES}.shared_with_user_id`, userId)
    .andWhere(`${FOLDERS}.is_deleted`, false)
    .select(`${FOLDERS}.*`);

  return { files, folders };
}

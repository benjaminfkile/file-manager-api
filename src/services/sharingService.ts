import { getDb } from "../db/db";
import { IFile, IFileShare, IFolder, IFolderShare, ISharedFile, ISharedFolder } from "../interfaces";

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

/** Get all shares for a file with user details. */
export async function getFileSharesWithUsers(
  fileId: string
): Promise<{ id: string; username: string; first_name: string; last_name: string; sharedAt: string }[]> {
  const db = getDb();
  return db(FILE_SHARES)
    .join(USERS, `${FILE_SHARES}.shared_with_user_id`, `${USERS}.id`)
    .where(`${FILE_SHARES}.file_id`, fileId)
    .orderBy(`${FILE_SHARES}.created_at`, "asc")
    .select(
      `${USERS}.id`,
      `${USERS}.username`,
      `${USERS}.first_name`,
      `${USERS}.last_name`,
      `${FILE_SHARES}.created_at as sharedAt`
    );
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

/** Get all files and folders shared with a user (includes who shared them). */
export async function getItemsSharedWithUser(
  userId: string
): Promise<{ files: ISharedFile[]; folders: ISharedFolder[] }> {
  const db = getDb();

  const rawFiles = await db(FILES)
    .join(FILE_SHARES, `${FILES}.id`, `${FILE_SHARES}.file_id`)
    .join(USERS, `${FILE_SHARES}.owner_user_id`, `${USERS}.id`)
    .where(`${FILE_SHARES}.shared_with_user_id`, userId)
    .andWhere(`${FILES}.is_deleted`, false)
    .select(
      `${FILES}.*`,
      `${USERS}.username as shared_by_username`,
      `${USERS}.first_name as shared_by_first_name`,
      `${USERS}.last_name as shared_by_last_name`
    );

  const files: ISharedFile[] = rawFiles.map((r: any) => ({
    id: r.id,
    user_id: r.user_id,
    folder_id: r.folder_id,
    name: r.name,
    s3_key: r.s3_key,
    size_bytes: r.size_bytes,
    mime_type: r.mime_type,
    is_deleted: r.is_deleted,
    deleted_at: r.deleted_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    shared_by: {
      username: r.shared_by_username,
      first_name: r.shared_by_first_name,
      last_name: r.shared_by_last_name,
    },
  }));

  const rawFolders = await db(FOLDERS)
    .join(FOLDER_SHARES, `${FOLDERS}.id`, `${FOLDER_SHARES}.folder_id`)
    .join(USERS, `${FOLDER_SHARES}.owner_user_id`, `${USERS}.id`)
    .where(`${FOLDER_SHARES}.shared_with_user_id`, userId)
    .andWhere(`${FOLDERS}.is_deleted`, false)
    .select(
      `${FOLDERS}.*`,
      `${USERS}.username as shared_by_username`,
      `${USERS}.first_name as shared_by_first_name`,
      `${USERS}.last_name as shared_by_last_name`
    );

  const folders: ISharedFolder[] = rawFolders.map((r: any) => ({
    id: r.id,
    user_id: r.user_id,
    parent_folder_id: r.parent_folder_id,
    name: r.name,
    is_deleted: r.is_deleted,
    deleted_at: r.deleted_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    shared_by: {
      username: r.shared_by_username,
      first_name: r.shared_by_first_name,
      last_name: r.shared_by_last_name,
    },
  }));

  return { files, folders };
}

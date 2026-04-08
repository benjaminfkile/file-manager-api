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

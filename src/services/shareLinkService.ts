import { randomBytes } from "crypto";
import { getDb } from "../db/db";
import { IShareLink } from "../interfaces";

const TABLE = "share_links";

/**
 * Create a shareable link for a file or folder.
 * expiresInSeconds — if null, the link never expires.
 */
export async function createShareLink(
  createdByUserId: string,
  resource: { fileId: string } | { folderId: string },
  expiresInSeconds: number | null
): Promise<IShareLink> {
  const db = getDb();
  const token = randomBytes(32).toString("hex");
  const expiresAt =
    expiresInSeconds !== null
      ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
      : null;

  const fileId = "fileId" in resource ? resource.fileId : null;
  const folderId = "folderId" in resource ? resource.folderId : null;

  // Replace any existing active link for this resource + owner
  if (fileId) {
    await db(TABLE)
      .where({ file_id: fileId, created_by_user_id: createdByUserId })
      .del();
  } else {
    await db(TABLE)
      .where({ folder_id: folderId, created_by_user_id: createdByUserId })
      .del();
  }

  const [link] = await db(TABLE)
    .insert({
      token,
      file_id: fileId,
      folder_id: folderId,
      created_by_user_id: createdByUserId,
      expires_at: expiresAt,
    })
    .returning("*");

  return link;
}

/**
 * Find a share link by token. Returns null if not found or expired.
 */
export async function findShareLinkByToken(
  token: string
): Promise<IShareLink | null> {
  const db = getDb();
  const link = await db(TABLE).where({ token }).first();

  if (!link) return null;

  // Filter out expired links
  if (link.expires_at && new Date(link.expires_at) <= new Date()) {
    return null;
  }

  return link;
}

/**
 * Get the current share link for a file (for a given owner). Returns null if none.
 */
export async function getShareLinkForFile(
  fileId: string,
  ownerUserId: string
): Promise<IShareLink | null> {
  const db = getDb();
  const link = await db(TABLE)
    .where({ file_id: fileId, created_by_user_id: ownerUserId })
    .whereRaw("(expires_at IS NULL OR expires_at > NOW())")
    .orderBy("created_at", "desc")
    .first();

  return link || null;
}

/**
 * Get the current share link for a folder (for a given owner). Returns null if none.
 */
export async function getShareLinkForFolder(
  folderId: string,
  ownerUserId: string
): Promise<IShareLink | null> {
  const db = getDb();
  const link = await db(TABLE)
    .where({ folder_id: folderId, created_by_user_id: ownerUserId })
    .whereRaw("(expires_at IS NULL OR expires_at > NOW())")
    .orderBy("created_at", "desc")
    .first();

  return link || null;
}

/**
 * Revoke (delete) a share link by its ID, verifying ownership.
 * Throws if not found or if the requester is not the creator.
 */
export async function revokeShareLink(
  shareLinkId: string,
  requestingUserId: string
): Promise<void> {
  const db = getDb();
  const link = await db(TABLE).where({ id: shareLinkId }).first();

  if (!link) {
    throw new Error("Share link not found");
  }

  if (link.created_by_user_id !== requestingUserId) {
    throw new Error("Access denied");
  }

  await db(TABLE).where({ id: shareLinkId }).del();
}

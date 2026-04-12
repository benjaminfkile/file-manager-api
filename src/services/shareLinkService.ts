import { getDb } from "../db/db";
import { IPublicShareLink } from "../interfaces";

const TABLE = "public_share_links";

/** Create a public share link for a file or folder. */
export async function createShareLink(
  ownerId: string,
  resourceType: "file" | "folder",
  resourceId: string,
  expiresAt: Date | null
): Promise<IPublicShareLink> {
  const db = getDb();
  const [link] = await db(TABLE)
    .insert({
      resource_type: resourceType,
      resource_id: resourceId,
      owner_user_id: ownerId,
      expires_at: expiresAt,
    })
    .returning("*");
  return link;
}

/** Delete a public share link. Throws if not found or not owner. */
export async function deleteShareLink(
  linkId: string,
  ownerId: string
): Promise<void> {
  const db = getDb();
  const deleted = await db(TABLE)
    .where({ id: linkId, owner_user_id: ownerId })
    .del();

  if (deleted === 0) {
    throw new Error("Share link not found");
  }
}

/** Get all share links for a specific resource owned by the user. */
export async function getShareLinksForResource(
  ownerId: string,
  resourceType: string,
  resourceId: string
): Promise<IPublicShareLink[]> {
  const db = getDb();
  return db(TABLE)
    .where({
      owner_user_id: ownerId,
      resource_type: resourceType,
      resource_id: resourceId,
    })
    .orderBy("created_at", "asc");
}

/** Look up a share link by its public token. */
export async function getShareLinkByToken(
  token: string
): Promise<IPublicShareLink | null> {
  const db = getDb();
  const link = await db(TABLE).where({ token }).first();
  return link ?? null;
}

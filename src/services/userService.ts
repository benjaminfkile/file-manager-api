import { getDb } from "../db/db";
import { IUser } from "../interfaces";
import { deleteCognitoUserBySub } from "../aws/cognitoAdmin";
import { deleteObjects, listObjectsByPrefix } from "../aws/s3Service";

const USERS = "users";

export async function createUser(
  firstName: string,
  lastName: string,
  username: string,
  cognitoSub: string,
  expiresAt: Date | null = null,
): Promise<Omit<IUser, "cognito_sub" | "updated_at">> {
  const db = getDb();

  const existing = await db<IUser>(USERS).where("username", username).first();
  if (existing) {
    throw new Error("Username is already taken");
  }

  const [user] = await db<IUser>(USERS)
    .insert({
      first_name: firstName,
      last_name: lastName,
      username,
      cognito_sub: cognitoSub,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
    })
    .returning(["id", "first_name", "last_name", "username", "expires_at", "created_at"]);

  return user;
}

/** Fetch a single user by id. */
export async function getUserById(userId: string): Promise<IUser | null> {
  const db = getDb();
  const user = await db<IUser>(USERS).where("id", userId).first();
  return user ?? null;
}

/** Search users by username (case-insensitive), optionally excluding a user. */
export async function searchUsersByUsername(
  query: string,
  excludeUserId?: string
): Promise<Pick<IUser, "id" | "username" | "first_name" | "last_name">[]> {
  const db = getDb();
  let q = db<IUser>(USERS)
    .select("id", "username", "first_name", "last_name")
    .whereRaw("username ILIKE ?", [`%${query}%`]);

  if (excludeUserId) {
    q = q.andWhere("id", "!=", excludeUserId);
  }

  return q;
}

/** Look up a user by their Cognito sub (subject) identifier. */
export async function getUserByCognitoSub(sub: string): Promise<IUser | null> {
  const db = getDb();
  const user = await db<IUser>(USERS).where("cognito_sub", sub).first();
  return user ?? null;
}

/** Returns users whose expires_at has elapsed. Used by the user sweeper. */
export async function findExpiredUsers(): Promise<IUser[]> {
  const db = getDb();
  return db<IUser>(USERS).whereRaw("expires_at IS NOT NULL AND expires_at < NOW()");
}

/**
 * Wipes a user end-to-end:
 *  1. Lists every S3 object under `files/{user.id}/` and bulk-deletes them.
 *  2. Calls AdminDeleteUser on the user's Cognito sub (best-effort — logs and
 *     continues if the Cognito user is already gone).
 *  3. Deletes the users row. FK cascades clear folders, files, upload_sessions,
 *     share_links, file_shares, and folder_shares.
 *
 * Each step is best-effort so a transient failure in one doesn't strand state
 * in the other two — the sweeper will catch up on its next tick.
 */
export async function deleteUserCompletely(user: Pick<IUser, "id" | "cognito_sub">): Promise<void> {
  const db = getDb();

  try {
    const keys = await listObjectsByPrefix(`files/${user.id}/`);
    if (keys.length > 0) {
      await deleteObjects(keys);
    }
  } catch (err) {
    console.warn(`[userService] S3 cleanup failed for user ${user.id}:`, (err as Error).message);
  }

  if (user.cognito_sub) {
    try {
      await deleteCognitoUserBySub(user.cognito_sub);
    } catch (err) {
      console.warn(
        `[userService] Cognito delete failed for sub ${user.cognito_sub}:`,
        (err as Error).message
      );
    }
  }

  await db<IUser>(USERS).where("id", user.id).del();
}

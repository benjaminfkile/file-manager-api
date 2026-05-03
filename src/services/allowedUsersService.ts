import { getDb } from "../db/db";
import { IAllowedUser } from "../interfaces";

const ALLOWED_USERS = "allowed_users";

/** Returns true if the email exists in the allow-list (case-insensitive via citext). */
export async function isEmailAllowed(email: string): Promise<boolean> {
  const db = getDb();
  const row = await db<IAllowedUser>(ALLOWED_USERS).where("email", email).first();
  return Boolean(row);
}

/** Stamps `used_at = now()` on the allow-list row so the operator can see who's signed up. */
export async function markEmailUsed(email: string): Promise<void> {
  const db = getDb();
  await db<IAllowedUser>(ALLOWED_USERS)
    .where("email", email)
    .update({ used_at: db.fn.now() });
}

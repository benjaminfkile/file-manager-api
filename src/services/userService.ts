import { getDb } from "../db/db";
import { IUser } from "../interfaces";

const USERS = "users";

export async function createUser(
  firstName: string,
  lastName: string,
  username: string,
  cognitoSub: string,
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
    })
    .returning(["id", "first_name", "last_name", "username", "created_at"]);

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

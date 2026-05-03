import { getDb } from "../db/db";
import { IUser } from "../interfaces";
import {
  findExpiredUsers,
  findUsersNotInAllowList,
  deleteUserCompletely,
} from "./userService";
import { listAllCognitoUsers, deleteCognitoUserBySub } from "../aws/cognitoAdmin";

const SWEEP_INTERVAL_MS = 60 * 1000;
const ORPHAN_GRACE_MS = 10 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let isProduction = false;

/**
 * Deletes any user whose `expires_at` has elapsed. Returns the number of
 * users swept. Each deletion runs end-to-end (S3, Cognito, DB) — see
 * `deleteUserCompletely`.
 */
export async function sweepExpiredUsers(): Promise<number> {
  const expired = await findExpiredUsers();

  for (const user of expired) {
    try {
      await deleteUserCompletely(user);
    } catch (err) {
      console.warn(`[userSweeper] failed to sweep user ${user.id}:`, (err as Error).message);
    }
  }

  if (expired.length > 0) {
    console.log(`[userSweeper] swept ${expired.length} expired user(s)`);
  }
  return expired.length;
}

/**
 * Defensive cleanup for Cognito users with no matching local row. This catches
 * two cases:
 *   1. /register failed mid-flight (validation error after Cognito signup).
 *   2. Production rejection deleted the row but AdminDeleteUser failed — the
 *      next sweep tick retries it.
 *
 * Only Cognito users older than ORPHAN_GRACE_MS are considered, so we don't
 * race a user who just signed up and is on their way to /register.
 */
export async function sweepOrphanCognitoUsers(): Promise<number> {
  let cognitoUsers;
  try {
    cognitoUsers = await listAllCognitoUsers();
  } catch (err) {
    console.warn("[userSweeper] listAllCognitoUsers failed:", (err as Error).message);
    return 0;
  }

  if (cognitoUsers.length === 0) return 0;

  const db = getDb();
  const subs = cognitoUsers.map((u) => u.sub).filter(Boolean);
  const knownRows = subs.length
    ? await db<IUser>("users").whereIn("cognito_sub", subs).select("cognito_sub")
    : [];
  const knownSubs = new Set(knownRows.map((r) => r.cognito_sub));

  const cutoff = Date.now() - ORPHAN_GRACE_MS;
  let deleted = 0;

  for (const cu of cognitoUsers) {
    if (!cu.sub) continue;
    if (knownSubs.has(cu.sub)) continue;
    if (!cu.createdAt || cu.createdAt.getTime() > cutoff) continue;

    try {
      await deleteCognitoUserBySub(cu.sub);
      deleted++;
    } catch (err) {
      console.warn(
        `[userSweeper] AdminDeleteUser failed for orphan sub ${cu.sub}:`,
        (err as Error).message
      );
    }
  }

  if (deleted > 0) {
    console.log(`[userSweeper] cleaned up ${deleted} orphan Cognito user(s)`);
  }
  return deleted;
}

/**
 * Production-only: deletes any user whose email is no longer in the
 * `allowed_users` table. Lets the operator revoke access by simply removing
 * an allow-list row — within one tick (60s) the account, S3 contents, and
 * Cognito user are all gone.
 *
 * No-op outside production: dev relies on the TTL sweep, and the allow-list
 * isn't enforced at registration there either.
 */
export async function sweepDisallowedUsers(): Promise<number> {
  if (!isProduction) return 0;

  const disallowed = await findUsersNotInAllowList();

  for (const user of disallowed) {
    try {
      await deleteUserCompletely(user);
    } catch (err) {
      console.warn(
        `[userSweeper] failed to sweep disallowed user ${user.id}:`,
        (err as Error).message
      );
    }
  }

  if (disallowed.length > 0) {
    console.log(`[userSweeper] swept ${disallowed.length} disallowed user(s)`);
  }
  return disallowed.length;
}

export async function runUserSweep(): Promise<void> {
  await sweepExpiredUsers();
  await sweepDisallowedUsers();
  await sweepOrphanCognitoUsers();
}

/**
 * Starts the periodic sweeper. Runs once immediately, then every 60s.
 * No-op if already started or if `process.env.DISABLE_USER_SWEEPER === "true"`,
 * which lets tests skip the interval.
 *
 * `production` toggles the disallowed-user pass — that pass should never run
 * in dev, where there's no allow-list and accounts are TTL-managed.
 */
export function startUserSweeper(production = false): void {
  isProduction = production;
  if (process.env.DISABLE_USER_SWEEPER === "true") return;
  if (timer) return;

  runUserSweep().catch((err) => {
    console.error("[userSweeper] initial sweep failed:", err);
  });

  timer = setInterval(() => {
    runUserSweep().catch((err) => {
      console.error("[userSweeper] scheduled sweep failed:", err);
    });
  }, SWEEP_INTERVAL_MS);
}

/** Stops the sweeper interval. Used for tests / graceful shutdown. */
export function stopUserSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

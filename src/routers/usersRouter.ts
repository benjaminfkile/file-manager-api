import express, { Request, Response } from "express";
import { getDb } from "../db/db";
import { IAppSecrets, IUser } from "../interfaces";
import protectedRoute from "../middleware/protectedRoute";
import verifyToken from "../middleware/verifyToken";
import { createUser } from "../services/userService";
import { isEmailAllowed, markEmailUsed } from "../services/allowedUsersService";
import { deleteCognitoUserBySub } from "../aws/cognitoAdmin";

const usersRouter = express.Router();

const DEV_ACCOUNT_TTL_MS = 60 * 60 * 1000;

/**
 * POST /api/users/register
 * Creates a new user account. Uses verifyToken — the user has a Cognito JWT but no local record yet.
 * Body: { first_name, last_name, username }
 *
 * In production: rejects emails not in the `allowed_users` table and deletes
 * the just-created Cognito user.
 * In dev: stamps `expires_at = now + 1h` so the demo sweeper later wipes the
 * account and everything it owns.
 */
usersRouter.route("/register").post(verifyToken(), async (req: Request, res: Response) => {
  try {
    const { first_name, last_name, username } = req.body;
    const cognitoSub = req.cognitoSub!;
    const cognitoEmail = req.cognitoEmail ?? null;

    // Validate all fields present
    if (!first_name || !last_name || !username) {
      return res.status(400).json({
        status: "error",
        error: true,
        errorMsg: "All fields are required: first_name, last_name, username",
      });
    }

    // Validate username is alphanumeric + underscores only
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({
        status: "error",
        error: true,
        errorMsg: "Username must contain only letters, numbers, and underscores",
      });
    }

    const db = getDb();

    // Check username not already taken
    const existing = await db<IUser>("users").where("username", username).first();
    if (existing) {
      return res.status(409).json({
        status: "error",
        error: true,
        errorMsg: "Username is already taken",
      });
    }

    const secrets = req.app.get("secrets") as IAppSecrets;
    const isProd = secrets.NODE_ENV === "production";

    if (isProd) {
      if (!cognitoEmail) {
        return res.status(400).json({
          status: "error",
          error: true,
          errorMsg: "Email claim missing from token",
        });
      }
      const allowed = await isEmailAllowed(cognitoEmail);
      if (!allowed) {
        // Not on the allow-list — purge the Cognito user we just verified so
        // they can't keep a half-active account around. Logged but otherwise
        // best-effort: the user sweeper's orphan pass is the safety net.
        try {
          await deleteCognitoUserBySub(cognitoSub);
        } catch (err) {
          console.warn(
            `[register] AdminDeleteUser failed for sub ${cognitoSub}:`,
            (err as Error).message
          );
        }
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "This email is not on the allow-list. Reach out to request access.",
        });
      }
    }

    const expiresAt = isProd ? null : new Date(Date.now() + DEV_ACCOUNT_TTL_MS);

    const user = await createUser(first_name, last_name, username, cognitoSub, expiresAt);

    if (isProd && cognitoEmail) {
      await markEmailUsed(cognitoEmail).catch((err) => {
        // Non-fatal — the row was created; we just couldn't stamp used_at.
        console.warn(
          `[register] markEmailUsed failed for ${cognitoEmail}:`,
          (err as Error).message
        );
      });
    }

    return res.status(201).json({
      status: "ok",
      error: false,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: true,
      errorMsg: (error as Error).message,
    });
  }
});

/**
 * GET /api/users/me
 * Returns the currently authenticated user. Behind protectedRoute.
 */
usersRouter.route("/me").get(protectedRoute(), (req: Request, res: Response) => {
  const user = req.user as IUser;

  return res.status(200).json({
    status: "ok",
    error: false,
    data: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      expires_at: user.expires_at,
      created_at: user.created_at,
    },
  });
});

/**
 * GET /api/users/search?q=<partial_username>
 * Searches users by username (ILIKE). Excludes the requesting user.
 * Behind protectedRoute.
 */
usersRouter
  .route("/search")
  .get(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const { q } = req.query;

      if (!q || typeof q !== "string") {
        return res.status(400).json({
          status: "error",
          error: true,
          errorMsg: "Query parameter 'q' is required",
        });
      }

      const currentUser = req.user as IUser;
      const db = getDb();

      const users = await db<IUser>("users")
        .select("id", "username", "first_name", "last_name")
        .whereRaw("username ILIKE ?", [`%${q}%`])
        .andWhere("id", "!=", currentUser.id);

      return res.status(200).json({
        status: "ok",
        error: false,
        data: users,
      });
    } catch (error) {
      res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  });

export default usersRouter;

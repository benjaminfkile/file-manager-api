import express, { Request, Response } from "express";
import { getDb } from "../db/db";
import { IUser } from "../interfaces";
import protectedRoute from "../middleware/protectedRoute";
import verifyToken from "../middleware/verifyToken";
import { createUser } from "../services/userService";

const usersRouter = express.Router();

/**
 * POST /api/users/register
 * Creates a new user account. Uses verifyToken — the user has a Cognito JWT but no local record yet.
 * Body: { first_name, last_name, username }
 */
usersRouter.route("/register").post(verifyToken(), async (req: Request, res: Response) => {
  try {
    const { first_name, last_name, username } = req.body;
    const cognitoSub = req.cognitoSub!;

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

    const user = await createUser(first_name, last_name, username, cognitoSub);

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

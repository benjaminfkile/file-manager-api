import express, { Request, Response } from "express";
import bcrypt from "bcrypt";
import { getDb } from "../db/db";
import { IUser } from "../interfaces";
import protectedRoute from "../middleware/protectedRoute";

const usersRouter = express.Router();

/**
 * POST /api/users/register
 * Creates a new user account. Not behind protectedRoute — this is how users obtain access.
 * Body: { first_name, last_name, username, api_key }
 */
usersRouter.route("/register").post(async (req: Request, res: Response) => {
  try {
    const { first_name, last_name, username, api_key } = req.body;

    // Validate all fields present
    if (!first_name || !last_name || !username || !api_key) {
      return res.status(400).json({
        status: "error",
        error: true,
        errorMsg: "All fields are required: first_name, last_name, username, api_key",
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

    // Hash api_key with bcrypt and extract prefix
    const api_key_hash = await bcrypt.hash(api_key, 10);
    const api_key_prefix = api_key.slice(0, 8);

    // Insert user and return the created record
    const [user] = await db<IUser>("users")
      .insert({
        first_name,
        last_name,
        username,
        api_key_hash,
        api_key_prefix,
      })
      .returning(["id", "first_name", "last_name", "username", "created_at"]);

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

export default usersRouter;

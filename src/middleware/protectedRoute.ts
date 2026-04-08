import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { getDb } from "../db/db";
import { IUser } from "../interfaces";

/**
 * Middleware that authenticates requests using per-user API keys.
 * The caller must send the key in the `x-api-key` header.
 *
 * The first 8 characters of the raw key are stored as `api_key_prefix`
 * so the DB can narrow the bcrypt compare to a single row.
 *
 * On success the matched user is attached to `req.user`.
 *
 * Usage: app.use("/api/admin", protectedRoute(), adminRouter);
 */
const protectedRoute = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const provided = req.headers["x-api-key"];
    if (!provided || typeof provided !== "string") {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const prefix = provided.slice(0, 8);

    const db = getDb();
    const user = await db<IUser>("users")
      .where("api_key_prefix", prefix)
      .first();

    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const isValid = await bcrypt.compare(provided, user.api_key_hash);
    if (!isValid) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.user = user;
    next();
  };
};

export default protectedRoute;

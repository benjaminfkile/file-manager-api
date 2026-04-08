import express, { Request, Response } from "express";
import protectedRoute from "../middleware/protectedRoute";
import { listDeletedFiles } from "../services/fileService";
import { listDeletedFolders } from "../services/folderService";
import { getDb } from "../db/db";
import { IUser } from "../interfaces";

const recycleBinRouter = express.Router();

/**
 * GET /api/recycle-bin
 * List all soft-deleted items owned by the current user.
 * Returns only top-level deleted items to avoid duplicates when a whole tree was deleted.
 */
recycleBinRouter
  .route("/")
  .get(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const [folders, files] = await Promise.all([
        listDeletedFolders(user.id),
        listDeletedFiles(user.id),
      ]);
      res.json({ folders, files });
    } catch (err) {
      console.error("[GET /api/recycle-bin]", err);
      res.status(500).json({ error: true, errorMsg: "Failed to list recycle bin contents." });
    }
  });

/**
 * POST /api/recycle-bin/restore-all
 * Restore all soft-deleted files and folders owned by the current user.
 */
recycleBinRouter
  .route("/restore-all")
  .post(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const db = getDb();
      const now = new Date().toISOString();

      const result = await db.transaction(async (trx) => {
        const restoredFolders = await trx("folders")
          .where({ user_id: user.id, is_deleted: true })
          .update({ is_deleted: false, deleted_at: null, updated_at: now });

        const restoredFiles = await trx("files")
          .where({ user_id: user.id, is_deleted: true })
          .update({ is_deleted: false, deleted_at: null, updated_at: now });

        return { restoredFolders, restoredFiles };
      });

      res.json({ restoredFolders: result.restoredFolders, restoredFiles: result.restoredFiles });
    } catch (err) {
      console.error("[POST /api/recycle-bin/restore-all]", err);
      res.status(500).json({ error: true, errorMsg: "Failed to restore all items." });
    }
  });

export default recycleBinRouter;

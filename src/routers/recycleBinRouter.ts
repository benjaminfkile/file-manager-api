import express, { Request, Response } from "express";
import protectedRoute from "../middleware/protectedRoute";
import { listDeletedFiles } from "../services/fileService";
import { listDeletedFolders } from "../services/folderService";
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

export default recycleBinRouter;

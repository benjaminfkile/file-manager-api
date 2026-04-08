import express, { Request, Response } from "express";
import { IUser } from "../interfaces";
import protectedRoute from "../middleware/protectedRoute";
import { createFolder, getFolderById, listRootFolders } from "../services/folderService";

const foldersRouter = express.Router();

/**
 * POST /api/folders
 * Creates a new folder. Behind protectedRoute.
 * Body: { name: string, parentFolderId?: string }
 */
foldersRouter
  .route("/")
  .get(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const folders = await listRootFolders(user.id);
      return res.status(200).json({ folders });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  })
  .post(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { name, parentFolderId } = req.body;

      // Validate name is present and non-empty
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({
          status: "error",
          error: true,
          errorMsg: "Folder name is required and must be a non-empty string",
        });
      }

      // Validate no path traversal characters
      if (/[\/\\]/.test(name) || name === "." || name === "..") {
        return res.status(400).json({
          status: "error",
          error: true,
          errorMsg:
            "Folder name must not contain path traversal characters (/, \\, ., ..)",
        });
      }

      // If parentFolderId provided, verify it exists, is not deleted, and is owned by user
      if (parentFolderId) {
        const parentFolder = await getFolderById(parentFolderId);

        if (!parentFolder) {
          return res.status(404).json({
            status: "error",
            error: true,
            errorMsg: "Parent folder not found",
          });
        }

        if (parentFolder.user_id !== user.id) {
          return res.status(403).json({
            status: "error",
            error: true,
            errorMsg: "You do not own the specified parent folder",
          });
        }
      }

      const folder = await createFolder(user.id, name.trim(), parentFolderId);

      return res.status(201).json({
        status: "ok",
        error: false,
        data: folder,
      });
    } catch (error) {
      res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  });

export default foldersRouter;

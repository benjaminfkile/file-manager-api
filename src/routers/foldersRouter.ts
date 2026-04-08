import express, { Request, Response } from "express";
import { IUser } from "../interfaces";
import protectedRoute from "../middleware/protectedRoute";
import { createFolder, collectFolderFiles, getDeletedFolderById, getFolderById, hardDeleteFolder, listFolderContents, listRootFolders, renameFolder, restoreFolder, softDeleteFolder } from "../services/folderService";
import { shareFolder } from "../services/sharingService";
import { getDb } from "../db/db";
import { deleteObjects, getObjectStream } from "../aws/s3Service";
import { canAccessFolder } from "../utils/accessControl";
import archiver from "archiver";

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

/**
 * GET /api/folders/:id
 * Returns folder details and its direct children (sub-folders and files).
 * User must own the folder or have a folder_shares record.
 */
foldersRouter
  .route("/:id")
  .get(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { id } = req.params;

      const folder = await getFolderById(id);

      if (!folder) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "Folder not found",
        });
      }

      const hasAccess = await canAccessFolder(user.id, id);

      if (!hasAccess) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Access denied",
        });
      }

      const { subFolders, files } = await listFolderContents(id);

      return res.status(200).json({ folder, subFolders, files });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  })
  .patch(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { id } = req.params;
      const { name } = req.body;

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

      const folder = await getFolderById(id);

      if (!folder) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "Folder not found",
        });
      }

      // Only the owner can rename
      if (folder.user_id !== user.id) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Access denied",
        });
      }

      const updatedFolder = await renameFolder(id, name.trim());

      return res.status(200).json({
        status: "ok",
        error: false,
        data: updatedFolder,
      });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  })
  .delete(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { id } = req.params;

      const folder = await getFolderById(id);

      if (!folder) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "Folder not found",
        });
      }

      // Only the owner can delete
      if (folder.user_id !== user.id) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Access denied",
        });
      }

      await softDeleteFolder(id);

      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  });

/**
 * GET /api/folders/:id/download
 * Download a folder as a zip archive.
 * User must own or have shared access to the folder.
 */
foldersRouter
  .route("/:id/download")
  .get(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { id } = req.params;

      const folder = await getFolderById(id);

      if (!folder) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "Folder not found",
        });
      }

      const hasAccess = await canAccessFolder(user.id, id);

      if (!hasAccess) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Access denied",
        });
      }

      const files = await collectFolderFiles(id);

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${folder.name}.zip"`
      );

      const archive = archiver("zip", { zlib: { level: 5 } });

      archive.on("error", (err) => {
        res.status(500).json({
          status: "error",
          error: true,
          errorMsg: err.message,
        });
      });

      archive.pipe(res);

      for (const file of files) {
        const stream = await getObjectStream(file.s3_key);
        archive.append(stream, { name: file.zipPath });
      }

      await archive.finalize();
    } catch (error) {
      if (!res.headersSent) {
        return res.status(500).json({
          status: "error",
          error: true,
          errorMsg: (error as Error).message,
        });
      }
    }
  });

/**
 * POST /api/folders/:id/restore
 * Restore a soft-deleted folder from the recycle bin.
 * Only the owner can restore. If the parent folder is also soft-deleted, returns 409.
 */
foldersRouter
  .route("/:id/restore")
  .post(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { id } = req.params;

      const folder = await getDeletedFolderById(id);

      if (!folder) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "Folder not found",
        });
      }

      // Only the owner can restore
      if (folder.user_id !== user.id) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Access denied",
        });
      }

      // If the parent folder is also soft-deleted, block the restore
      if (folder.parent_folder_id) {
        const parentFolder = await getDeletedFolderById(folder.parent_folder_id);
        if (parentFolder) {
          return res.status(409).json({
            status: "error",
            error: true,
            errorMsg:
              "The parent folder is also in the recycle bin. Restore the parent folder first.",
          });
        }
      }

      await restoreFolder(id);

      const restoredFolder = await getFolderById(id);

      return res.status(200).json({
        status: "ok",
        error: false,
        data: restoredFolder,
      });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  });

/**
 * DELETE /api/folders/:id/permanent
 * Permanently delete a folder and its entire tree from the database and S3.
 * Only the owner can permanently delete.
 */
foldersRouter
  .route("/:id/permanent")
  .delete(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { id } = req.params;

      const folder = await getDeletedFolderById(id);

      if (!folder) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "Folder not found",
        });
      }

      // Only the owner can permanently delete
      if (folder.user_id !== user.id) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Access denied",
        });
      }

      await hardDeleteFolder(id, deleteObjects);

      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  });

foldersRouter
  .route("/:id/share")
  .post(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const folderId = req.params.id;
      const { username } = req.body;

      if (!username || typeof username !== "string" || username.trim().length === 0) {
        return res.status(400).json({
          status: "error",
          error: true,
          errorMsg: "username is required and must be a non-empty string",
        });
      }

      const folder = await getFolderById(folderId);
      if (!folder) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "Folder not found",
        });
      }

      if (folder.user_id !== user.id) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Only the folder owner can share this folder",
        });
      }

      // Look up target user
      const db = getDb();
      const targetUser = await db("users").where({ username: username.trim() }).first();
      if (!targetUser) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: `User "${username.trim()}" not found`,
        });
      }

      // Check if share already exists
      const existingShare = await db("folder_shares")
        .where({ folder_id: folderId, shared_with_user_id: targetUser.id })
        .first();
      if (existingShare) {
        return res.status(409).json({
          status: "error",
          error: true,
          errorMsg: "Folder is already shared with this user",
        });
      }

      await shareFolder(folderId, user.id, username.trim());

      return res.status(201).json({
        sharedWith: {
          id: targetUser.id,
          username: targetUser.username,
          first_name: targetUser.first_name,
          last_name: targetUser.last_name,
        },
      });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  });

export default foldersRouter;

import express, { Request, Response } from "express";
import multer, { memoryStorage } from "multer";
import { randomUUID } from "crypto";
import { IAppSecrets, IUser } from "../interfaces";
import protectedRoute from "../middleware/protectedRoute";
import { createFileRecord, getFileById, getDeletedFileById, renameFile, softDeleteFile, restoreFile, hardDeleteFile } from "../services/fileService";
import { buildS3Key, uploadObject, generatePresignedDownloadUrl, generateSignedCloudFrontUrl, deleteObject } from "../aws/s3Service";
import { canAccessFile } from "../utils/accessControl";
import { getDeletedFolderById } from "../services/folderService";
import { shareFile, unshareFile, getFileSharesWithUsers } from "../services/sharingService";
import { getDb } from "../db/db";

const filesRouter = express.Router();

/**
 * POST /api/files/upload
 * Upload a file. Behind protectedRoute.
 * Accepts multipart/form-data: file (binary), folderId (optional UUID), name (optional filename override).
 */
filesRouter
  .route("/upload")
  .post(protectedRoute(), (req: Request, res: Response, next) => {
    const secrets = req.app.get("secrets") as IAppSecrets;
    const maxBytes = secrets.MAX_UPLOAD_BYTES;

    const upload = multer({
      storage: memoryStorage(),
      limits: { fileSize: maxBytes },
    }).single("file");

    upload(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            status: "error",
            error: true,
            errorMsg: `File exceeds maximum upload size of ${maxBytes} bytes`,
          });
        }
        return res.status(400).json({
          status: "error",
          error: true,
          errorMsg: err.message,
        });
      }
      next();
    });
  }, async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          status: "error",
          error: true,
          errorMsg: "No file provided",
        });
      }

      const folderId: string | null = req.body.folderId || null;
      const filename: string = req.body.name || file.originalname;
      const fileId = randomUUID();
      const s3Key = buildS3Key(user.id, fileId, filename);

      await uploadObject(s3Key, file.buffer, file.mimetype, file.size);

      const record = await createFileRecord(
        user.id,
        folderId,
        filename,
        s3Key,
        file.size,
        file.mimetype
      );

      return res.status(201).json({ file: record });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  });

/**
 * GET /api/files/:id/download
 * Generate a short-lived signed URL for downloading a file.
 * Uses CloudFront if configured, otherwise falls back to S3 presigned URL.
 */
filesRouter
  .route("/:id/download")
  .get(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const fileId = req.params.id;

      const hasAccess = await canAccessFile(user.id, fileId);
      if (!hasAccess) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "File not found",
        });
      }

      const file = (await getFileById(fileId))!;

      const secrets = req.app.get("secrets") as IAppSecrets;
      const expiresIn = 60; // 60 seconds

      let url: string;

      if (
        secrets.CLOUDFRONT_DOMAIN &&
        secrets.CLOUDFRONT_KEY_PAIR_ID &&
        secrets.CLOUDFRONT_PRIVATE_KEY
      ) {
        url = generateSignedCloudFrontUrl(
          secrets.CLOUDFRONT_DOMAIN,
          file.s3_key,
          secrets.CLOUDFRONT_KEY_PAIR_ID,
          secrets.CLOUDFRONT_PRIVATE_KEY,
          expiresIn
        );
      } else {
        url = await generatePresignedDownloadUrl(file.s3_key, expiresIn);
      }

      return res.status(200).json({ url });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  });

/**
 * GET /api/files/:id/preview
 * Generate a signed URL for previewing media (images, video) in the browser.
 * Returns { url, mimeType, expiresAt } with a configurable TTL (default 15 minutes).
 * Uses CloudFront if configured, otherwise falls back to S3 presigned URL.
 */
filesRouter
  .route("/:id/preview")
  .get(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const fileId = req.params.id;

      const hasAccess = await canAccessFile(user.id, fileId);
      if (!hasAccess) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "File not found",
        });
      }

      const file = (await getFileById(fileId))!;

      const secrets = req.app.get("secrets") as IAppSecrets;
      const expiresIn = secrets.PREVIEW_URL_TTL ?? 900; // default 15 minutes

      let url: string;

      if (
        secrets.CLOUDFRONT_DOMAIN &&
        secrets.CLOUDFRONT_KEY_PAIR_ID &&
        secrets.CLOUDFRONT_PRIVATE_KEY
      ) {
        url = generateSignedCloudFrontUrl(
          secrets.CLOUDFRONT_DOMAIN,
          file.s3_key,
          secrets.CLOUDFRONT_KEY_PAIR_ID,
          secrets.CLOUDFRONT_PRIVATE_KEY,
          expiresIn
        );
      } else {
        url = await generatePresignedDownloadUrl(file.s3_key, expiresIn);
      }

      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      return res.status(200).json({ url, mimeType: file.mime_type, expiresAt });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  });

/**
 * PATCH /api/files/:id
 * Rename a file. Only the owner can rename.
 * Body: { name: string }
 * Preserves the original file extension if omitted in the new name.
 */
filesRouter
  .route("/:id")
  .patch(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { id } = req.params;
      const { name } = req.body;

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({
          status: "error",
          error: true,
          errorMsg: "File name is required and must be a non-empty string",
        });
      }

      if (/[\/\\]/.test(name) || name === "." || name === "..") {
        return res.status(400).json({
          status: "error",
          error: true,
          errorMsg: "File name must not contain path traversal characters (/, \\, ., ..)",
        });
      }

      const file = await getFileById(id);
      if (!file) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "File not found",
        });
      }

      if (file.user_id !== user.id) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Access denied",
        });
      }

      // Preserve original extension if the new name doesn't include one
      let finalName = name.trim();
      const originalExt = file.name.includes(".")
        ? file.name.slice(file.name.lastIndexOf("."))
        : "";
      const newHasExt = finalName.includes(".");
      if (!newHasExt && originalExt) {
        finalName = finalName + originalExt;
      }

      const updatedFile = await renameFile(id, finalName);

      return res.status(200).json({
        status: "ok",
        error: false,
        data: updatedFile,
      });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  })
  /**
   * DELETE /api/files/:id
   * Soft-delete a file (move to recycle bin). Only the owner can delete.
   * Sets is_deleted = true and deleted_at = now(). Does NOT remove from S3.
   * Returns 204 No Content.
   */
  .delete(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { id } = req.params;

      const file = await getFileById(id);
      if (!file) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "File not found",
        });
      }

      if (file.user_id !== user.id) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Access denied",
        });
      }

      await softDeleteFile(id);

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
 * POST /api/files/:id/restore
 * Restore a soft-deleted file from the recycle bin.
 * Only the owner can restore. If the parent folder is also soft-deleted, returns 409.
 * Returns 200 with the restored IFile.
 */
filesRouter
  .route("/:id/restore")
  .post(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { id } = req.params;

      const file = await getDeletedFileById(id);
      if (!file) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "File not found",
        });
      }

      if (file.user_id !== user.id) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Access denied",
        });
      }

      if (file.folder_id) {
        const parentFolder = await getDeletedFolderById(file.folder_id);
        if (parentFolder) {
          return res.status(409).json({
            status: "error",
            error: true,
            errorMsg: "The parent folder is also in the recycle bin. Restore the parent folder first.",
          });
        }
      }

      await restoreFile(id);

      const restoredFile = await getFileById(id);

      return res.status(200).json({
        status: "ok",
        error: false,
        data: restoredFile,
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
 * DELETE /api/files/:id/permanent
 * Permanently delete a file. Only the owner can permanently delete.
 * Deletes the S3 object first, then removes the DB record (cascades to share records).
 * Returns 204 No Content.
 */
filesRouter
  .route("/:id/permanent")
  .delete(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { id } = req.params;

      const file = await getFileById(id);
      if (!file) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "File not found",
        });
      }

      if (file.user_id !== user.id) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Access denied",
        });
      }

      await hardDeleteFile(id, deleteObject);

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
 * POST /api/files/:id/share
 * Share a file with another user. Only the file owner can share.
 * Body: { username: string }
 * Returns 201 with { sharedWith: { id, username, first_name, last_name } }
 */
filesRouter
  .route("/:id/share")
  .post(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const fileId = req.params.id;
      const { username } = req.body;

      if (!username || typeof username !== "string" || username.trim().length === 0) {
        return res.status(400).json({
          status: "error",
          error: true,
          errorMsg: "username is required and must be a non-empty string",
        });
      }

      const file = await getFileById(fileId);
      if (!file) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "File not found",
        });
      }

      if (file.user_id !== user.id) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Only the file owner can share this file",
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
      const existingShare = await db("file_shares")
        .where({ file_id: fileId, shared_with_user_id: targetUser.id })
        .first();
      if (existingShare) {
        return res.status(409).json({
          status: "error",
          error: true,
          errorMsg: "File is already shared with this user",
        });
      }

      await shareFile(fileId, user.id, username.trim());

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

/**
 * DELETE /api/files/:id/share/:sharedUserId
 * Remove a file share. Only the file owner can remove a share.
 * Returns 204 on success.
 */
filesRouter
  .route("/:id/share/:sharedUserId")
  .delete(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const fileId = req.params.id;
      const sharedUserId = req.params.sharedUserId;

      const file = await getFileById(fileId);
      if (!file) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "File not found",
        });
      }

      if (file.user_id !== user.id) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Only the file owner can remove a share",
        });
      }

      await unshareFile(fileId, user.id, sharedUserId);

      return res.status(204).send();
    } catch (error) {
      const message = (error as Error).message;
      if (message === "File share not found") {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: message,
        });
      }
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: message,
      });
    }
  });

/**
 * GET /api/files/:id/shares
 * List users a file is shared with. Only the file owner can see the share list.
 * Returns { sharedWith: [{ id, username, first_name, last_name, sharedAt }] }
 */
filesRouter
  .route("/:id/shares")
  .get(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const fileId = req.params.id;

      const file = await getFileById(fileId);
      if (!file) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "File not found",
        });
      }

      if (file.user_id !== user.id) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Only the file owner can view shares",
        });
      }

      const sharedWith = await getFileSharesWithUsers(fileId);

      return res.status(200).json({ sharedWith });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  });

export default filesRouter;

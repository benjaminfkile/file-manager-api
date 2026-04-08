import express, { Request, Response } from "express";
import multer, { memoryStorage } from "multer";
import { v4 as uuidv4 } from "uuid";
import { IAppSecrets, IUser } from "../interfaces";
import protectedRoute from "../middleware/protectedRoute";
import { createFileRecord, getFileById } from "../services/fileService";
import { buildS3Key, uploadObject, generatePresignedDownloadUrl, generateSignedCloudFrontUrl } from "../aws/s3Service";
import { canAccessFile } from "../utils/accessControl";

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
      const fileId = uuidv4();
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

      const file = await getFileById(fileId);
      if (!file) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "File not found",
        });
      }

      const hasAccess = await canAccessFile(user.id, fileId);
      if (!hasAccess) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Forbidden",
        });
      }

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

      const file = await getFileById(fileId);
      if (!file) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "File not found",
        });
      }

      const hasAccess = await canAccessFile(user.id, fileId);
      if (!hasAccess) {
        return res.status(403).json({
          status: "error",
          error: true,
          errorMsg: "Forbidden",
        });
      }

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

export default filesRouter;

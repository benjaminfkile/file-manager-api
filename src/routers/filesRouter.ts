import express, { Request, Response } from "express";
import multer, { memoryStorage } from "multer";
import { v4 as uuidv4 } from "uuid";
import { IAppSecrets, IUser } from "../interfaces";
import protectedRoute from "../middleware/protectedRoute";
import { createFileRecord } from "../services/fileService";
import { buildS3Key, uploadObject } from "../aws/s3Service";

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

export default filesRouter;

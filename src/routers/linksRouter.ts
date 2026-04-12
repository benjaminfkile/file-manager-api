import express, { Request, Response } from "express";
import { IAppSecrets } from "../interfaces";
import { findShareLinkByToken } from "../services/shareLinkService";
import { getFileById } from "../services/fileService";
import { getFolderById } from "../services/folderService";
import { generatePresignedDownloadUrl, generateSignedCloudFrontUrl } from "../aws/s3Service";

const linksRouter = express.Router();

/**
 * GET /api/links/:token
 * Public endpoint — no authentication required.
 * Resolves a share-link token to file/folder metadata.
 */
linksRouter
  .route("/:token")
  .get(async (req: Request, res: Response) => {
    try {
      const { token } = req.params;

      const link = await findShareLinkByToken(token);
      if (!link) {
        return res.status(404).json({
          status: "error",
          error: true,
          errorMsg: "Link not found or expired",
        });
      }

      if (link.file_id) {
        const file = await getFileById(link.file_id);
        if (!file || file.is_deleted) {
          return res.status(404).json({
            status: "error",
            error: true,
            errorMsg: "File not found",
          });
        }

        const secrets = req.app.get("secrets") as IAppSecrets;
        const expiresIn = Number(secrets.PREVIEW_URL_TTL ?? 900);

        let downloadUrl: string;

        if (
          secrets.CLOUDFRONT_DOMAIN &&
          secrets.CLOUDFRONT_KEY_PAIR_ID &&
          secrets.CLOUDFRONT_PRIVATE_KEY
        ) {
          downloadUrl = generateSignedCloudFrontUrl(
            secrets.CLOUDFRONT_DOMAIN,
            file.s3_key,
            secrets.CLOUDFRONT_KEY_PAIR_ID,
            secrets.CLOUDFRONT_PRIVATE_KEY,
            expiresIn
          );
        } else {
          downloadUrl = await generatePresignedDownloadUrl(file.s3_key, expiresIn);
        }

        return res.status(200).json({
          type: "file",
          name: file.name,
          mimeType: file.mime_type,
          sizeBytes: file.size_bytes,
          downloadUrl,
        });
      }

      if (link.folder_id) {
        const folder = await getFolderById(link.folder_id);
        if (!folder || folder.is_deleted) {
          return res.status(404).json({
            status: "error",
            error: true,
            errorMsg: "Folder not found",
          });
        }

        return res.status(200).json({
          type: "folder",
          name: folder.name,
          downloadUrl: null,
        });
      }

      return res.status(404).json({
        status: "error",
        error: true,
        errorMsg: "Link not found",
      });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  });

export default linksRouter;

import express, { Request, Response } from "express";
import { getShareLinkByToken } from "../services/shareLinkService";
import { getFileById } from "../services/fileService";
import { getFolderById, collectFolderFiles } from "../services/folderService";
import { generatePresignedDownloadUrl, getObjectStream } from "../aws/s3Service";
import archiver from "archiver";

const publicShareRouter = express.Router();

/**
 * GET /api/public/share/:token
 * Look up a public share link by token. No authentication required.
 * Returns file metadata + signed download URL, or folder metadata.
 */
publicShareRouter
  .route("/:token")
  .get(async (req: Request, res: Response) => {
    try {
      const { token } = req.params;

      const link = await getShareLinkByToken(token);
      if (!link) {
        return res.status(404).json({ error: "Link not found" });
      }

      if (link.expires_at && new Date(link.expires_at) < new Date()) {
        return res.status(410).json({ error: "Link has expired" });
      }

      if (link.resource_type === "file") {
        const file = await getFileById(link.resource_id);
        if (!file) {
          return res.status(404).json({ error: "File not found" });
        }

        const downloadUrl = await generatePresignedDownloadUrl(file.s3_key, 3600);

        return res.status(200).json({
          resourceType: "file",
          name: file.name,
          sizeBytes: file.size_bytes,
          mimeType: file.mime_type,
          downloadUrl,
        });
      }

      if (link.resource_type === "folder") {
        const folder = await getFolderById(link.resource_id);
        if (!folder) {
          return res.status(404).json({ error: "Folder not found" });
        }

        return res.status(200).json({
          resourceType: "folder",
          name: folder.name,
          downloadUrl: `/api/public/share/${token}/download`,
        });
      }

      return res.status(400).json({ error: "Unknown resource type" });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: true,
        errorMsg: (error as Error).message,
      });
    }
  });

/**
 * GET /api/public/share/:token/download
 * Stream a folder as a zip archive via a public share link. No authentication required.
 */
publicShareRouter
  .route("/:token/download")
  .get(async (req: Request, res: Response) => {
    try {
      const { token } = req.params;

      const link = await getShareLinkByToken(token);
      if (!link) {
        return res.status(404).json({ error: "Link not found" });
      }

      if (link.expires_at && new Date(link.expires_at) < new Date()) {
        return res.status(410).json({ error: "Link has expired" });
      }

      if (link.resource_type !== "folder") {
        return res.status(400).json({ error: "Download endpoint is only for folder links" });
      }

      const folder = await getFolderById(link.resource_id);
      if (!folder) {
        return res.status(404).json({ error: "Folder not found" });
      }

      const files = await collectFolderFiles(folder.id);

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

export default publicShareRouter;

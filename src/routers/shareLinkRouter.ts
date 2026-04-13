import express, { Request, Response } from "express";
import protectedRoute from "../middleware/protectedRoute";
import {
  createShareLink,
  getShareLinkByToken,
  revokeShareLink,
  getShareLinksForItem,
  isFolderDescendant,
} from "../services/sharingService";
import { getFileById } from "../services/fileService";
import { getFolderById, listFolderContents } from "../services/folderService";
import {
  generatePresignedDownloadUrl,
  generateSignedCloudFrontUrl,
  getObjectStream,
  headObject,
} from "../aws/s3Service";
import { IAppSecrets, IShareLink, IUser } from "../interfaces";

const shareLinkRouter = express.Router();

// ---------------------------------------------------------------------------
// Helper — verify a file is reachable via a share link
// ---------------------------------------------------------------------------

async function validateFileViaLink(
  link: IShareLink,
  fileId: string,
  fileFolderId: string | null
): Promise<boolean> {
  if (link.item_type === "file") {
    return link.item_id === fileId;
  }
  // Folder link — the file must live inside the shared folder tree
  if (!fileFolderId) return false;
  return isFolderDescendant(fileFolderId, link.item_id);
}

// ---------------------------------------------------------------------------
// Protected: list links for an item (MUST be defined before /:token routes)
// ---------------------------------------------------------------------------

/**
 * GET /api/share-links/item/:itemType/:itemId
 * List all active share links the authenticated user created for an item.
 */
shareLinkRouter
  .route("/item/:itemType/:itemId")
  .get(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { itemType, itemId } = req.params;

      if (itemType !== "file" && itemType !== "folder") {
        return res
          .status(400)
          .json({ error: true, errorMsg: "itemType must be 'file' or 'folder'" });
      }

      const links = await getShareLinksForItem(
        itemType as "file" | "folder",
        itemId,
        user.id
      );
      return res.status(200).json({ links });
    } catch (err: any) {
      return res.status(500).json({ error: true, errorMsg: err.message });
    }
  });

// ---------------------------------------------------------------------------
// Protected: create a share link
// ---------------------------------------------------------------------------

/**
 * POST /api/share-links
 * Body: { itemType: 'file' | 'folder', itemId: string, expiresAt?: string (ISO) }
 */
shareLinkRouter
  .route("/")
  .post(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { itemType, itemId, expiresAt } = req.body;

      if (!itemType || !itemId) {
        return res
          .status(400)
          .json({ error: true, errorMsg: "itemType and itemId are required" });
      }

      if (itemType !== "file" && itemType !== "folder") {
        return res
          .status(400)
          .json({ error: true, errorMsg: "itemType must be 'file' or 'folder'" });
      }

      // Validate ownership
      if (itemType === "file") {
        const file = await getFileById(itemId);
        if (!file || file.user_id !== user.id) {
          return res.status(403).json({ error: true, errorMsg: "You do not own this file" });
        }
      } else {
        const folder = await getFolderById(itemId);
        if (!folder || folder.user_id !== user.id) {
          return res.status(403).json({ error: true, errorMsg: "You do not own this folder" });
        }
      }

      const parsedExpiresAt =
        expiresAt ? new Date(expiresAt).toISOString() : null;

      const link = await createShareLink(itemType, itemId, user.id, parsedExpiresAt);
      return res.status(201).json({ link });
    } catch (err: any) {
      return res.status(500).json({ error: true, errorMsg: err.message });
    }
  });

// ---------------------------------------------------------------------------
// Protected: revoke a share link
// ---------------------------------------------------------------------------

/**
 * DELETE /api/share-links/:token
 */
shareLinkRouter
  .route("/:token")
  .delete(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      await revokeShareLink(req.params.token, user.id);
      return res.status(204).send();
    } catch (err: any) {
      const status = err.message === "Share link not found" ? 404 : 500;
      return res.status(status).json({ error: true, errorMsg: err.message });
    }
  });

// ---------------------------------------------------------------------------
// Public: resolve a share link — returns root item + contents if folder
// ---------------------------------------------------------------------------

/**
 * GET /api/share-links/:token
 */
shareLinkRouter
  .route("/:token")
  .get(async (req: Request, res: Response) => {
    try {
      const link = await getShareLinkByToken(req.params.token);
      if (!link) {
        return res
          .status(404)
          .json({ error: true, errorMsg: "Share link not found or has expired" });
      }

      if (link.item_type === "file") {
        const file = await getFileById(link.item_id);
        if (!file || file.is_deleted) {
          return res.status(404).json({ error: true, errorMsg: "File not found" });
        }
        return res.status(200).json({
          linkInfo: { expires_at: link.expires_at },
          itemType: "file",
          file,
        });
      }

      // Folder
      const folder = await getFolderById(link.item_id);
      if (!folder || folder.is_deleted) {
        return res.status(404).json({ error: true, errorMsg: "Folder not found" });
      }
      const { subFolders, files } = await listFolderContents(link.item_id);
      return res.status(200).json({
        linkInfo: { expires_at: link.expires_at },
        itemType: "folder",
        folder,
        subFolders,
        files,
      });
    } catch (err: any) {
      return res.status(500).json({ error: true, errorMsg: err.message });
    }
  });

// ---------------------------------------------------------------------------
// Public: browse a subfolder via share link
// ---------------------------------------------------------------------------

/**
 * GET /api/share-links/:token/folders/:folderId
 * folderId must be a descendant of the originally shared folder.
 */
shareLinkRouter
  .route("/:token/folders/:folderId")
  .get(async (req: Request, res: Response) => {
    try {
      const link = await getShareLinkByToken(req.params.token);
      if (!link) {
        return res
          .status(404)
          .json({ error: true, errorMsg: "Share link not found or has expired" });
      }

      if (link.item_type !== "folder") {
        return res
          .status(400)
          .json({ error: true, errorMsg: "This share link points to a file, not a folder" });
      }

      const { folderId } = req.params;
      const isDescendant = await isFolderDescendant(folderId, link.item_id);
      if (!isDescendant) {
        return res
          .status(403)
          .json({ error: true, errorMsg: "Folder is not accessible via this share link" });
      }

      const folder = await getFolderById(folderId);
      if (!folder || folder.is_deleted) {
        return res.status(404).json({ error: true, errorMsg: "Folder not found" });
      }

      const { subFolders, files } = await listFolderContents(folderId);
      return res.status(200).json({ folder, subFolders, files });
    } catch (err: any) {
      return res.status(500).json({ error: true, errorMsg: err.message });
    }
  });

// ---------------------------------------------------------------------------
// Public: get a preview URL for a file via share link
// ---------------------------------------------------------------------------

/**
 * GET /api/share-links/:token/files/:fileId/preview
 */
shareLinkRouter
  .route("/:token/files/:fileId/preview")
  .get(async (req: Request, res: Response) => {
    try {
      const link = await getShareLinkByToken(req.params.token);
      if (!link) {
        return res
          .status(404)
          .json({ error: true, errorMsg: "Share link not found or has expired" });
      }

      const file = await getFileById(req.params.fileId);
      if (!file || file.is_deleted) {
        return res.status(404).json({ error: true, errorMsg: "File not found" });
      }

      const hasAccess = await validateFileViaLink(link, file.id, file.folder_id);
      if (!hasAccess) {
        return res
          .status(403)
          .json({ error: true, errorMsg: "File is not accessible via this share link" });
      }

      const secrets = req.app.get("secrets") as IAppSecrets;
      const expiresIn = Number(secrets.PREVIEW_URL_TTL ?? 900);

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
    } catch (err: any) {
      return res.status(500).json({ error: true, errorMsg: err.message });
    }
  });

// ---------------------------------------------------------------------------
// Public: download a file via share link
// ---------------------------------------------------------------------------

/**
 * GET /api/share-links/:token/files/:fileId/download
 */
shareLinkRouter
  .route("/:token/files/:fileId/download")
  .get(async (req: Request, res: Response) => {
    try {
      const link = await getShareLinkByToken(req.params.token);
      if (!link) {
        return res
          .status(404)
          .json({ error: true, errorMsg: "Share link not found or has expired" });
      }

      const file = await getFileById(req.params.fileId);
      if (!file || file.is_deleted) {
        return res.status(404).json({ error: true, errorMsg: "File not found" });
      }

      const hasAccess = await validateFileViaLink(link, file.id, file.folder_id);
      if (!hasAccess) {
        return res
          .status(403)
          .json({ error: true, errorMsg: "File is not accessible via this share link" });
      }

      const { contentLength, contentType } = await headObject(file.s3_key);
      const stream = await getObjectStream(file.s3_key);

      const encodedName = encodeURIComponent(file.name).replace(/'/g, "%27");
      const safeName = file.name.replace(/"/g, '\\"');

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", contentLength);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`
      );

      stream.pipe(res);
    } catch (err: any) {
      if (!res.headersSent) {
        return res.status(500).json({ error: true, errorMsg: err.message });
      }
    }
  });

export default shareLinkRouter;

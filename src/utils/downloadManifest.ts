import { collectFolderFiles } from "../services/folderService";
import { generatePresignedDownloadUrl } from "../aws/s3Service";
import { IAppSecrets } from "../interfaces";

export interface DownloadManifestEntry {
  zipPath: string;
  url: string;
  size: number;
}

export interface DownloadManifest {
  folderName: string;
  totalBytes: number;
  expiresAt: string;
  files: DownloadManifestEntry[];
}

/**
 * Default folder-download URL TTL (6 hours). The browser issues one fetch per
 * file as the streamed zip progresses, so URLs need to outlive even a slow
 * end-user connection finishing a big folder.
 */
const DEFAULT_FOLDER_DOWNLOAD_TTL_SECONDS = 6 * 60 * 60;

/**
 * Build a download manifest for a folder tree: enumerate every non-deleted
 * file, sign a per-file S3 GET URL, and return paths relative to the folder
 * root. The browser pulls bytes from S3 directly using these URLs — the API
 * server itself never touches file content.
 *
 * `zipPath` is prefixed with the folder's own name so the resulting zip
 * unpacks into a directory matching the folder.
 */
export async function buildDownloadManifest(
  folderName: string,
  folderId: string,
  secrets: IAppSecrets
): Promise<DownloadManifest> {
  const ttl = Number(
    secrets.FOLDER_DOWNLOAD_URL_TTL ?? DEFAULT_FOLDER_DOWNLOAD_TTL_SECONDS
  );

  const entries = await collectFolderFiles(folderId);

  const files: DownloadManifestEntry[] = await Promise.all(
    entries.map(async (entry) => {
      const url = await generatePresignedDownloadUrl(entry.s3_key, ttl);
      const zipPath = entry.zipPath
        ? `${folderName}/${entry.zipPath}`
        : `${folderName}/`;
      return { zipPath, url, size: entry.size_bytes };
    })
  );

  const totalBytes = files.reduce((acc, f) => acc + (f.size ?? 0), 0);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  return { folderName, totalBytes, expiresAt, files };
}

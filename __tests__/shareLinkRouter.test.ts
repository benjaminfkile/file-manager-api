import request from "supertest";
import { IFile, IFolder, IShareLink, IUser } from "../src/interfaces";

/* ------------------------------------------------------------------ */
/*  Module mocks that must be declared before app import               */
/* ------------------------------------------------------------------ */

jest.mock("uuid", () => ({ v4: () => "mock-uuid" }));

jest.mock("../src/services/fileService");
jest.mock("../src/services/folderService");
jest.mock("../src/services/sharingService");
jest.mock("../src/utils/accessControl");
jest.mock("../src/aws/s3Service");
jest.mock("../src/db/db", () => ({
  getDb: jest.fn(),
}));

import app from "../src/app";
import { getFileById } from "../src/services/fileService";
import {
  collectFolderFiles,
  getFolderById,
} from "../src/services/folderService";
import {
  getShareLinkByToken,
  isFolderDescendant,
} from "../src/services/sharingService";
import {
  generatePresignedDownloadUrl,
} from "../src/aws/s3Service";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                          */
/* ------------------------------------------------------------------ */

const ownerUser: IUser = {
  id: "user-owner-1111",
  first_name: "Owner",
  last_name: "Smith",
  username: "owner",
  cognito_sub: "cognito-owner",
  expires_at: null,
  email: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const sharedFolder: IFolder = {
  id: "folder-shared-aaaa",
  user_id: ownerUser.id,
  parent_folder_id: null,
  name: "Shared Folder",
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const folderShareLink: IShareLink = {
  id: "link-1",
  token: "tok-folder-share",
  item_type: "folder",
  item_id: sharedFolder.id,
  owner_user_id: ownerUser.id,
  expires_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

const fileShareLink: IShareLink = {
  id: "link-2",
  token: "tok-file-share",
  item_type: "file",
  item_id: "file-xxxx",
  owner_user_id: ownerUser.id,
  expires_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

const sharedFile: IFile = {
  id: "file-xxxx",
  user_id: ownerUser.id,
  folder_id: null,
  name: "report.pdf",
  s3_key: `files/${ownerUser.id}/file-xxxx/report.pdf`,
  size_bytes: 1024,
  mime_type: "application/pdf",
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  app.set("secrets", {
    NODE_ENV: "development",
    PORT: "3000",
    DB_NAME: "testdb",
    DB_HOST: "localhost",
    DB_PROXY_URL: "",
    S3_BUCKET_NAME: "test-bucket",
    MAX_UPLOAD_BYTES: "10485760",
    PREVIEW_URL_TTL: "900",
  });
});

/* ================================================================== */
/*  GET /api/share-links/:token/folders/:folderId/download-manifest   */
/* ================================================================== */

describe("GET /api/share-links/:token/folders/:folderId/download-manifest", () => {
  it("returns the manifest with one signed URL per file", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(sharedFolder);
    (collectFolderFiles as jest.Mock).mockResolvedValue([
      { s3_key: "files/o/1/a.mp4", zipPath: "a.mp4", size_bytes: 1000 },
    ]);
    (generatePresignedDownloadUrl as jest.Mock).mockResolvedValue(
      "https://s3.example/share-a"
    );

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/${sharedFolder.id}/download-manifest`
    );

    expect(res.status).toBe(200);
    expect(res.body.folderName).toBe(sharedFolder.name);
    expect(res.body.totalBytes).toBe(1000);
    expect(res.body.files).toEqual([
      {
        zipPath: `${sharedFolder.name}/a.mp4`,
        url: "https://s3.example/share-a",
        size: 1000,
      },
    ]);
  });

  it("returns 404 when the share link is invalid/expired", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get(
      `/api/share-links/bogus/folders/${sharedFolder.id}/download-manifest`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toMatch(/Share link not found/);
  });

  it("returns 400 when the share link points to a file, not a folder", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fileShareLink);

    const res = await request(app).get(
      `/api/share-links/${fileShareLink.token}/folders/${sharedFolder.id}/download-manifest`
    );

    expect(res.status).toBe(400);
    expect(res.body.errorMsg).toMatch(/share link points to a file/);
  });

  it("returns 403 when the folder is not the link target or descendant", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(false);

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/${sharedFolder.id}/download-manifest`
    );

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/not accessible/);
  });

  it("returns 404 when the folder is missing or deleted", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/${sharedFolder.id}/download-manifest`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });
});

/* ================================================================== */
/*  GET /api/share-links/:token/files/:fileId/download                 */
/* ================================================================== */

describe("GET /api/share-links/:token/files/:fileId/download", () => {
  it("returns 200 with { url, expiresAt } where url contains response-content-disposition", async () => {
    const presignedUrl =
      "https://s3.amazonaws.com/bucket/files/report.pdf" +
      "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&response-content-disposition=" +
      encodeURIComponent(`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fileShareLink);
    (getFileById as jest.Mock).mockResolvedValue(sharedFile);
    (generatePresignedDownloadUrl as jest.Mock).mockResolvedValue(presignedUrl);

    const res = await request(app).get(
      `/api/share-links/${fileShareLink.token}/files/${sharedFile.id}/download`
    );

    expect(res.status).toBe(200);
    expect(res.body.url).toBe(presignedUrl);
    expect(res.body.url).toMatch(/response-content-disposition=/);
    expect(typeof res.body.expiresAt).toBe("string");
    expect(generatePresignedDownloadUrl).toHaveBeenCalledWith(
      sharedFile.s3_key,
      900,
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`
    );
  });

  it("preserves RFC 5987 encoding for non-ASCII filenames", async () => {
    const unicodeFile: IFile = { ...sharedFile, name: "résumé.pdf" };
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fileShareLink);
    (getFileById as jest.Mock).mockResolvedValue(unicodeFile);
    (generatePresignedDownloadUrl as jest.Mock).mockResolvedValue(
      "https://s3.amazonaws.com/bucket/files/x?response-content-disposition=y"
    );

    await request(app).get(
      `/api/share-links/${fileShareLink.token}/files/${unicodeFile.id}/download`
    );

    const expectedEncoded = encodeURIComponent("résumé.pdf").replace(/'/g, "%27");
    expect(generatePresignedDownloadUrl).toHaveBeenCalledWith(
      unicodeFile.s3_key,
      900,
      `attachment; filename="résumé.pdf"; filename*=UTF-8''${expectedEncoded}`
    );
  });

  it("returns 404 when the share link is invalid", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get(
      `/api/share-links/bogus/files/${sharedFile.id}/download`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toMatch(/Share link not found/);
  });

  it("returns 404 when the file is missing or deleted", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fileShareLink);
    (getFileById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get(
      `/api/share-links/${fileShareLink.token}/files/${sharedFile.id}/download`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("File not found");
  });

  it("returns 403 when the file is not reachable via the share link", async () => {
    const otherFile: IFile = { ...sharedFile, id: "file-other" };
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fileShareLink);
    (getFileById as jest.Mock).mockResolvedValue(otherFile);

    const res = await request(app).get(
      `/api/share-links/${fileShareLink.token}/files/${otherFile.id}/download`
    );

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/not accessible/);
  });

  it("returns 500 when presigned URL generation fails", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fileShareLink);
    (getFileById as jest.Mock).mockResolvedValue(sharedFile);
    (generatePresignedDownloadUrl as jest.Mock).mockRejectedValue(
      new Error("S3 presign error")
    );

    const res = await request(app).get(
      `/api/share-links/${fileShareLink.token}/files/${sharedFile.id}/download`
    );

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("S3 presign error");
  });
});

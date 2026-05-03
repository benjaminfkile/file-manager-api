import request from "supertest";
import { IFolder, IShareLink, IUser, IZipJob } from "../src/interfaces";

/* ------------------------------------------------------------------ */
/*  Module mocks that must be declared before app import               */
/* ------------------------------------------------------------------ */

jest.mock("uuid", () => ({ v4: () => "mock-uuid" }));

jest.mock("../src/services/folderService");
jest.mock("../src/services/sharingService");
jest.mock("../src/services/zipJobService");
jest.mock("../src/utils/accessControl");
jest.mock("../src/aws/s3Service");
jest.mock("../src/db/db", () => ({
  getDb: jest.fn(),
}));

import app from "../src/app";
import { getFolderById } from "../src/services/folderService";
import {
  getShareLinkByToken,
  isFolderDescendant,
} from "../src/services/sharingService";
import { getOrCreateZipJob } from "../src/services/zipJobService";
import {
  generatePresignedDownloadUrl,
  generateSignedCloudFrontUrl,
} from "../src/aws/s3Service";
import { getDb } from "../src/db/db";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                          */
/* ------------------------------------------------------------------ */

const ownerUser: IUser = {
  id: "user-owner-1111",
  first_name: "Owner",
  last_name: "Smith",
  username: "owner",
  cognito_sub: "cognito-owner",
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

const pendingJob: IZipJob = {
  id: "job-share-1",
  user_id: ownerUser.id,
  folder_id: sharedFolder.id,
  zip_hash: "abcd1234",
  s3_key: `zip-cache/${ownerUser.id}/abcd1234.zip`,
  status: "pending",
  error: null,
  created_at: "2026-05-03T00:00:00Z",
  completed_at: null,
};

const cacheHitJob: IZipJob = {
  id: "cache-feedface",
  user_id: ownerUser.id,
  folder_id: sharedFolder.id,
  zip_hash: "feedface",
  s3_key: `zip-cache/${ownerUser.id}/feedface.zip`,
  status: "ready",
  error: null,
  created_at: "2026-05-03T00:00:00Z",
  completed_at: "2026-05-03T00:00:00Z",
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
/*  GET /api/share-links/:token/folders/:folderId/download/prepare    */
/* ================================================================== */

describe("GET /api/share-links/:token/folders/:folderId/download/prepare", () => {
  it("returns { jobId, status: 'pending' } on cache miss", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(sharedFolder);
    (getOrCreateZipJob as jest.Mock).mockResolvedValue(pendingJob);

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/${sharedFolder.id}/download/prepare`
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobId: pendingJob.id, status: "pending" });
    expect(getOrCreateZipJob).toHaveBeenCalledWith(ownerUser.id, sharedFolder.id);
  });

  it("returns { jobId, status: 'ready' } on cache hit", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(sharedFolder);
    (getOrCreateZipJob as jest.Mock).mockResolvedValue(cacheHitJob);

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/${sharedFolder.id}/download/prepare`
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobId: cacheHitJob.id, status: "ready" });
  });

  it("returns 404 when share link is invalid/expired", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get(
      `/api/share-links/bogus-token/folders/${sharedFolder.id}/download/prepare`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toMatch(/Share link not found/);
  });

  it("returns 400 when share link points to a file, not a folder", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fileShareLink);

    const res = await request(app).get(
      `/api/share-links/${fileShareLink.token}/folders/${sharedFolder.id}/download/prepare`
    );

    expect(res.status).toBe(400);
    expect(res.body.errorMsg).toMatch(/share link points to a file/);
  });

  it("returns 403 when folder is not the link target or descendant", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(false);

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/${sharedFolder.id}/download/prepare`
    );

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/not accessible/);
  });

  it("returns 404 when the folder itself is missing or deleted", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/${sharedFolder.id}/download/prepare`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });
});

/* ================================================================== */
/*  GET /api/share-links/:token/folders/:folderId/download/status/:id */
/* ================================================================== */

describe("GET /api/share-links/:token/folders/:folderId/download/status/:jobId", () => {
  it("returns { status: 'pending' } when the job is still running", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(sharedFolder);
    const dbInstance = jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        first: jest.fn().mockResolvedValue(pendingJob),
      }),
    });
    (getDb as jest.Mock).mockReturnValue(dbInstance);

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/${sharedFolder.id}/download/status/${pendingJob.id}`
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "pending" });
  });

  it("returns S3 presigned URL when ready and CloudFront is unconfigured", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(sharedFolder);
    const readyJob: IZipJob = { ...pendingJob, status: "ready" };
    const dbInstance = jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        first: jest.fn().mockResolvedValue(readyJob),
      }),
    });
    (getDb as jest.Mock).mockReturnValue(dbInstance);
    (generatePresignedDownloadUrl as jest.Mock).mockResolvedValue(
      "https://s3.example/share-presigned"
    );

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/${sharedFolder.id}/download/status/${readyJob.id}`
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.url).toBe("https://s3.example/share-presigned");
    expect(typeof res.body.expiresAt).toBe("string");
    expect(generatePresignedDownloadUrl).toHaveBeenCalledWith(
      readyJob.s3_key,
      900,
      `attachment; filename="${sharedFolder.name}.zip"`
    );
  });

  it("returns CloudFront signed URL when configured", async () => {
    app.set("secrets", {
      NODE_ENV: "development",
      PORT: "3000",
      DB_NAME: "testdb",
      DB_HOST: "localhost",
      DB_PROXY_URL: "",
      S3_BUCKET_NAME: "test-bucket",
      MAX_UPLOAD_BYTES: "10485760",
      PREVIEW_URL_TTL: "900",
      CLOUDFRONT_DOMAIN: "cdn.example",
      CLOUDFRONT_KEY_PAIR_ID: "KP123",
      CLOUDFRONT_PRIVATE_KEY: "PEMKEY",
    });

    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(sharedFolder);
    const readyJob: IZipJob = { ...pendingJob, status: "ready" };
    const dbInstance = jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        first: jest.fn().mockResolvedValue(readyJob),
      }),
    });
    (getDb as jest.Mock).mockReturnValue(dbInstance);
    (generateSignedCloudFrontUrl as jest.Mock).mockReturnValue(
      "https://cdn.example/share-signed"
    );

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/${sharedFolder.id}/download/status/${readyJob.id}`
    );

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://cdn.example/share-signed");
    expect(generateSignedCloudFrontUrl).toHaveBeenCalledWith(
      "cdn.example",
      readyJob.s3_key,
      "KP123",
      "PEMKEY",
      900
    );
  });

  it("resolves cache-* jobIds against the share-link owner", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(sharedFolder);
    (generatePresignedDownloadUrl as jest.Mock).mockResolvedValue(
      "https://s3.example/share-cache"
    );

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/${sharedFolder.id}/download/status/${cacheHitJob.id}`
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.url).toBe("https://s3.example/share-cache");
    expect(generatePresignedDownloadUrl).toHaveBeenCalledWith(
      `zip-cache/${ownerUser.id}/feedface.zip`,
      900,
      `attachment; filename="${sharedFolder.name}.zip"`
    );
  });

  it("returns { status: 'failed', error } when the job has failed", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(sharedFolder);
    const failedJob: IZipJob = {
      ...pendingJob,
      status: "failed",
      error: "boom",
    };
    const dbInstance = jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        first: jest.fn().mockResolvedValue(failedJob),
      }),
    });
    (getDb as jest.Mock).mockReturnValue(dbInstance);

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/${sharedFolder.id}/download/status/${failedJob.id}`
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "failed", error: "boom" });
  });

  it("returns 404 when the share link is invalid", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get(
      `/api/share-links/bogus/folders/${sharedFolder.id}/download/status/${pendingJob.id}`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toMatch(/Share link not found/);
  });

  it("returns 403 when folder is not in the share-link tree", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(false);

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/some-other-folder/download/status/${pendingJob.id}`
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 when the jobId belongs to a different owner", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(folderShareLink);
    (isFolderDescendant as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(sharedFolder);
    const otherOwnersJob: IZipJob = { ...pendingJob, user_id: "other-owner" };
    const dbInstance = jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        first: jest.fn().mockResolvedValue(otherOwnersJob),
      }),
    });
    (getDb as jest.Mock).mockReturnValue(dbInstance);

    const res = await request(app).get(
      `/api/share-links/${folderShareLink.token}/folders/${sharedFolder.id}/download/status/${otherOwnersJob.id}`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Zip job not found");
  });
});

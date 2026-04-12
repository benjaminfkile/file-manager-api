import request from "supertest";
import { IFile, IFolder, IShareLink } from "../src/interfaces";

/* ------------------------------------------------------------------ */
/*  Module mocks that must be declared before app import               */
/* ------------------------------------------------------------------ */

jest.mock("uuid", () => ({ v4: () => "mock-uuid" }));

jest.mock("../src/middleware/protectedRoute", () => {
  return {
    __esModule: true,
    default: jest.fn(() => (_req: any, _res: any, next: any) => {
      next();
    }),
  };
});

jest.mock("../src/services/shareLinkService");
jest.mock("../src/services/fileService");
jest.mock("../src/services/folderService");
jest.mock("../src/services/sharingService");
jest.mock("../src/utils/accessControl");
jest.mock("../src/aws/s3Service");
jest.mock("../src/db/db", () => ({
  getDb: jest.fn().mockReturnValue(jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      first: jest.fn(),
      select: jest.fn().mockReturnValue({
        orderBy: jest.fn(),
      }),
    }),
    whereIn: jest.fn().mockReturnValue({
      select: jest.fn(),
    }),
  })),
}));

import app from "../src/app";

app.set("secrets", {
  NODE_ENV: "development",
  PORT: "3000",
  DB_NAME: "testdb",
  DB_HOST: "localhost",
  DB_PROXY_URL: "",
  S3_BUCKET_NAME: "test-bucket",
  MAX_UPLOAD_BYTES: 10_485_760,
  PREVIEW_URL_TTL: "900",
});

import { findShareLinkByToken } from "../src/services/shareLinkService";
import { getFileById } from "../src/services/fileService";
import { getFolderById } from "../src/services/folderService";
import {
  generatePresignedDownloadUrl,
  generateSignedCloudFrontUrl,
} from "../src/aws/s3Service";

/* ------------------------------------------------------------------ */
/*  Fake data                                                         */
/* ------------------------------------------------------------------ */

const fakeFile: IFile = {
  id: "file-aaaa-aaaa-aaaa",
  user_id: "user-1111-1111-1111",
  folder_id: "folder-1111-1111-1111",
  name: "report.pdf",
  s3_key: "files/user-1111-1111-1111/file-aaaa-aaaa-aaaa/report.pdf",
  size_bytes: 2048,
  mime_type: "application/pdf",
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
};

const fakeFolder: IFolder = {
  id: "folder-aaaa-aaaa-aaaa",
  user_id: "user-1111-1111-1111",
  parent_folder_id: null,
  name: "My Folder",
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const fakeFileLink: IShareLink = {
  id: "link-1",
  token: "a".repeat(64),
  file_id: fakeFile.id,
  folder_id: null,
  created_by_user_id: "user-1111-1111-1111",
  expires_at: "2027-01-01T00:00:00.000Z",
  created_at: "2026-04-08T00:00:00.000Z",
};

const fakeFolderLink: IShareLink = {
  id: "link-2",
  token: "b".repeat(64),
  file_id: null,
  folder_id: fakeFolder.id,
  created_by_user_id: "user-1111-1111-1111",
  expires_at: null,
  created_at: "2026-04-08T00:00:00.000Z",
};

/* ------------------------------------------------------------------ */
/*  Reset mocks between tests                                         */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  jest.clearAllMocks();
});

/* ================================================================== */
/*  GET /api/links/:token                                              */
/* ================================================================== */

describe("GET /api/links/:token", () => {
  it("returns 200 with file metadata for a valid file token", async () => {
    (findShareLinkByToken as jest.Mock).mockResolvedValue(fakeFileLink);
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (generatePresignedDownloadUrl as jest.Mock).mockResolvedValue(
      "https://s3.amazonaws.com/bucket/files/report.pdf?signed"
    );

    const res = await request(app).get(`/api/links/${fakeFileLink.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "file",
      name: fakeFile.name,
      mimeType: fakeFile.mime_type,
      sizeBytes: fakeFile.size_bytes,
      downloadUrl: "https://s3.amazonaws.com/bucket/files/report.pdf?signed",
    });
    expect(findShareLinkByToken).toHaveBeenCalledWith(fakeFileLink.token);
    expect(getFileById).toHaveBeenCalledWith(fakeFile.id);
  });

  it("returns 200 with folder metadata for a valid folder token", async () => {
    (findShareLinkByToken as jest.Mock).mockResolvedValue(fakeFolderLink);
    (getFolderById as jest.Mock).mockResolvedValue(fakeFolder);

    const res = await request(app).get(`/api/links/${fakeFolderLink.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "folder",
      name: fakeFolder.name,
      downloadUrl: null,
    });
    expect(findShareLinkByToken).toHaveBeenCalledWith(fakeFolderLink.token);
    expect(getFolderById).toHaveBeenCalledWith(fakeFolder.id);
  });

  it("returns 404 when token is not found", async () => {
    (findShareLinkByToken as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get("/api/links/nonexistent-token");

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Link not found or expired");
  });

  it("returns 404 for an expired token (service returns null)", async () => {
    (findShareLinkByToken as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get("/api/links/expired-token");

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Link not found or expired");
  });

  it("returns 404 when file is soft-deleted", async () => {
    (findShareLinkByToken as jest.Mock).mockResolvedValue(fakeFileLink);
    (getFileById as jest.Mock).mockResolvedValue({
      ...fakeFile,
      is_deleted: true,
      deleted_at: "2026-04-05T00:00:00.000Z",
    });

    const res = await request(app).get(`/api/links/${fakeFileLink.token}`);

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("File not found");
  });
});

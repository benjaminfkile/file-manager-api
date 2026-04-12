import request from "supertest";
import { IFile, IFolder, IPublicShareLink, IUser } from "../src/interfaces";

/* ------------------------------------------------------------------ */
/*  Fake data                                                         */
/* ------------------------------------------------------------------ */

const testUser: IUser = {
  id: "user-1111-1111-1111",
  first_name: "Alice",
  last_name: "Anderson",
  username: "alice",
  cognito_sub: "cognito-sub-aaaa",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const otherUser: IUser = {
  id: "user-2222-2222-2222",
  first_name: "Bob",
  last_name: "Baker",
  username: "bob",
  cognito_sub: "cognito-sub-bbbb",
  created_at: "2026-01-02T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

const fakeFile: IFile = {
  id: "file-aaaa-aaaa-aaaa",
  user_id: testUser.id,
  folder_id: null,
  name: "report.pdf",
  s3_key: "files/user-1111-1111-1111/file-aaaa-aaaa-aaaa/report.pdf",
  size_bytes: 2048,
  mime_type: "application/pdf",
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
};

const otherUserFile: IFile = {
  id: "file-cccc-cccc-cccc",
  user_id: otherUser.id,
  folder_id: null,
  name: "bob-file.png",
  s3_key: "files/user-2222-2222-2222/file-cccc-cccc-cccc/bob-file.png",
  size_bytes: 4096,
  mime_type: "image/png",
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-04-02T00:00:00.000Z",
  updated_at: "2026-04-02T00:00:00.000Z",
};

const rootFolder: IFolder = {
  id: "folder-aaaa-aaaa-aaaa",
  user_id: testUser.id,
  parent_folder_id: null,
  name: "My Folder",
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const otherUserFolder: IFolder = {
  id: "folder-eeee-eeee-eeee",
  user_id: otherUser.id,
  parent_folder_id: null,
  name: "Bob Folder",
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-01-05T00:00:00.000Z",
  updated_at: "2026-01-05T00:00:00.000Z",
};

const fakeShareLink: IPublicShareLink = {
  id: "link-1111-1111-1111",
  token: "tok-aaaa-aaaa-aaaa",
  resource_type: "file",
  resource_id: fakeFile.id,
  owner_user_id: testUser.id,
  expires_at: null,
  created_at: "2026-04-10T00:00:00.000Z",
};

const fakeFolderShareLink: IPublicShareLink = {
  id: "link-2222-2222-2222",
  token: "tok-bbbb-bbbb-bbbb",
  resource_type: "folder",
  resource_id: rootFolder.id,
  owner_user_id: testUser.id,
  expires_at: null,
  created_at: "2026-04-10T00:00:00.000Z",
};

const expiredShareLink: IPublicShareLink = {
  id: "link-3333-3333-3333",
  token: "tok-expired",
  resource_type: "file",
  resource_id: fakeFile.id,
  owner_user_id: testUser.id,
  expires_at: "2020-01-01T00:00:00.000Z",
  created_at: "2026-04-10T00:00:00.000Z",
};

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

jest.mock("../src/middleware/protectedRoute", () => {
  const testUser = {
    id: "user-1111-1111-1111",
    first_name: "Alice",
    last_name: "Anderson",
    username: "alice",
    cognito_sub: "cognito-sub-aaaa",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  return {
    __esModule: true,
    default: jest.fn(() => (req: any, _res: any, next: any) => {
      req.user = testUser;
      next();
    }),
  };
});

jest.mock("../src/services/fileService");
jest.mock("../src/services/folderService");
jest.mock("../src/services/sharingService");
jest.mock("../src/services/shareLinkService");
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
});

import { getFileById } from "../src/services/fileService";
import { getFolderById, collectFolderFiles } from "../src/services/folderService";
import {
  createShareLink,
  getShareLinksForResource,
  deleteShareLink,
  getShareLinkByToken,
} from "../src/services/shareLinkService";
import { generatePresignedDownloadUrl, getObjectStream } from "../src/aws/s3Service";

/* ------------------------------------------------------------------ */
/*  Reset mocks between tests                                          */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  jest.clearAllMocks();
});

/* ================================================================== */
/*  POST /api/files/:id/share-links                                    */
/* ================================================================== */

describe("POST /api/files/:id/share-links", () => {
  it("returns 201 when creating a share link", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (createShareLink as jest.Mock).mockResolvedValue(fakeShareLink);

    const res = await request(app)
      .post(`/api/files/${fakeFile.id}/share-links`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.link).toEqual(fakeShareLink);
    expect(createShareLink).toHaveBeenCalledWith(testUser.id, "file", fakeFile.id, null);
  });

  it("passes expiresAt when provided", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (createShareLink as jest.Mock).mockResolvedValue({ ...fakeShareLink, expires_at: "2026-12-31T23:59:59.000Z" });

    const res = await request(app)
      .post(`/api/files/${fakeFile.id}/share-links`)
      .send({ expiresAt: "2026-12-31T23:59:59.000Z" });

    expect(res.status).toBe(201);
    expect(createShareLink).toHaveBeenCalledWith(
      testUser.id,
      "file",
      fakeFile.id,
      new Date("2026-12-31T23:59:59.000Z")
    );
  });

  it("returns 404 when file not found", async () => {
    (getFileById as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/files/${fakeFile.id}/share-links`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("File not found");
  });

  it("returns 403 when user is not file owner", async () => {
    (getFileById as jest.Mock).mockResolvedValue(otherUserFile);

    const res = await request(app)
      .post(`/api/files/${otherUserFile.id}/share-links`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/Only the file owner/);
  });

  it("returns 500 when service throws", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (createShareLink as jest.Mock).mockRejectedValue(new Error("DB error"));

    const res = await request(app)
      .post(`/api/files/${fakeFile.id}/share-links`)
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("DB error");
  });
});

/* ================================================================== */
/*  GET /api/files/:id/share-links                                     */
/* ================================================================== */

describe("GET /api/files/:id/share-links", () => {
  it("returns 200 with links", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (getShareLinksForResource as jest.Mock).mockResolvedValue([fakeShareLink]);

    const res = await request(app).get(`/api/files/${fakeFile.id}/share-links`);

    expect(res.status).toBe(200);
    expect(res.body.links).toHaveLength(1);
    expect(res.body.links[0]).toEqual(fakeShareLink);
  });

  it("returns empty array when no links exist", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (getShareLinksForResource as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get(`/api/files/${fakeFile.id}/share-links`);

    expect(res.status).toBe(200);
    expect(res.body.links).toEqual([]);
  });

  it("returns 404 when file not found", async () => {
    (getFileById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get("/api/files/nonexistent/share-links");

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("File not found");
  });

  it("returns 403 when user is not file owner", async () => {
    (getFileById as jest.Mock).mockResolvedValue(otherUserFile);

    const res = await request(app).get(`/api/files/${otherUserFile.id}/share-links`);

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/Only the file owner/);
  });

  it("returns 500 when service throws", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (getShareLinksForResource as jest.Mock).mockRejectedValue(new Error("DB error"));

    const res = await request(app).get(`/api/files/${fakeFile.id}/share-links`);

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("DB error");
  });
});

/* ================================================================== */
/*  DELETE /api/files/:id/share-links/:linkId                          */
/* ================================================================== */

describe("DELETE /api/files/:id/share-links/:linkId", () => {
  it("returns 204 on success", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (deleteShareLink as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app).delete(
      `/api/files/${fakeFile.id}/share-links/${fakeShareLink.id}`
    );

    expect(res.status).toBe(204);
    expect(deleteShareLink).toHaveBeenCalledWith(fakeShareLink.id, testUser.id);
  });

  it("returns 404 when file not found", async () => {
    (getFileById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).delete(
      `/api/files/nonexistent/share-links/${fakeShareLink.id}`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("File not found");
  });

  it("returns 403 when user is not file owner", async () => {
    (getFileById as jest.Mock).mockResolvedValue(otherUserFile);

    const res = await request(app).delete(
      `/api/files/${otherUserFile.id}/share-links/${fakeShareLink.id}`
    );

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/Only the file owner/);
  });

  it("returns 404 when link not found", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (deleteShareLink as jest.Mock).mockRejectedValue(new Error("Share link not found"));

    const res = await request(app).delete(
      `/api/files/${fakeFile.id}/share-links/nonexistent`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Share link not found");
  });

  it("returns 500 when service throws unexpected error", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (deleteShareLink as jest.Mock).mockRejectedValue(new Error("DB error"));

    const res = await request(app).delete(
      `/api/files/${fakeFile.id}/share-links/${fakeShareLink.id}`
    );

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("DB error");
  });
});

/* ================================================================== */
/*  POST /api/folders/:id/share-links                                  */
/* ================================================================== */

describe("POST /api/folders/:id/share-links", () => {
  it("returns 201 when creating a share link", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (createShareLink as jest.Mock).mockResolvedValue(fakeFolderShareLink);

    const res = await request(app)
      .post(`/api/folders/${rootFolder.id}/share-links`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.link).toEqual(fakeFolderShareLink);
    expect(createShareLink).toHaveBeenCalledWith(testUser.id, "folder", rootFolder.id, null);
  });

  it("returns 404 when folder not found", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/folders/${rootFolder.id}/share-links`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });

  it("returns 403 when user is not folder owner", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(otherUserFolder);

    const res = await request(app)
      .post(`/api/folders/${otherUserFolder.id}/share-links`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/Only the folder owner/);
  });

  it("returns 500 when service throws", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (createShareLink as jest.Mock).mockRejectedValue(new Error("DB error"));

    const res = await request(app)
      .post(`/api/folders/${rootFolder.id}/share-links`)
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("DB error");
  });
});

/* ================================================================== */
/*  GET /api/folders/:id/share-links                                   */
/* ================================================================== */

describe("GET /api/folders/:id/share-links", () => {
  it("returns 200 with links", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (getShareLinksForResource as jest.Mock).mockResolvedValue([fakeFolderShareLink]);

    const res = await request(app).get(`/api/folders/${rootFolder.id}/share-links`);

    expect(res.status).toBe(200);
    expect(res.body.links).toHaveLength(1);
    expect(res.body.links[0]).toEqual(fakeFolderShareLink);
  });

  it("returns 404 when folder not found", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get("/api/folders/nonexistent/share-links");

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });

  it("returns 403 when user is not folder owner", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(otherUserFolder);

    const res = await request(app).get(`/api/folders/${otherUserFolder.id}/share-links`);

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/Only the folder owner/);
  });
});

/* ================================================================== */
/*  DELETE /api/folders/:id/share-links/:linkId                        */
/* ================================================================== */

describe("DELETE /api/folders/:id/share-links/:linkId", () => {
  it("returns 204 on success", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (deleteShareLink as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app).delete(
      `/api/folders/${rootFolder.id}/share-links/${fakeFolderShareLink.id}`
    );

    expect(res.status).toBe(204);
    expect(deleteShareLink).toHaveBeenCalledWith(fakeFolderShareLink.id, testUser.id);
  });

  it("returns 404 when folder not found", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).delete(
      `/api/folders/nonexistent/share-links/${fakeFolderShareLink.id}`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });

  it("returns 403 when user is not folder owner", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(otherUserFolder);

    const res = await request(app).delete(
      `/api/folders/${otherUserFolder.id}/share-links/${fakeFolderShareLink.id}`
    );

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/Only the folder owner/);
  });

  it("returns 404 when link not found", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (deleteShareLink as jest.Mock).mockRejectedValue(new Error("Share link not found"));

    const res = await request(app).delete(
      `/api/folders/${rootFolder.id}/share-links/nonexistent`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Share link not found");
  });
});

/* ================================================================== */
/*  GET /api/public/share/:token — file link                           */
/* ================================================================== */

describe("GET /api/public/share/:token (file)", () => {
  it("returns 200 with file metadata and download URL", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fakeShareLink);
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (generatePresignedDownloadUrl as jest.Mock).mockResolvedValue("https://s3.example.com/signed-url");

    const res = await request(app).get(`/api/public/share/${fakeShareLink.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      resourceType: "file",
      name: fakeFile.name,
      sizeBytes: fakeFile.size_bytes,
      mimeType: fakeFile.mime_type,
      downloadUrl: "https://s3.example.com/signed-url",
    });
    expect(generatePresignedDownloadUrl).toHaveBeenCalledWith(fakeFile.s3_key, 3600);
  });

  it("returns 404 when token not found", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get("/api/public/share/nonexistent-token");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Link not found");
  });

  it("returns 410 when link has expired", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(expiredShareLink);

    const res = await request(app).get(`/api/public/share/${expiredShareLink.token}`);

    expect(res.status).toBe(410);
    expect(res.body.error).toBe("Link has expired");
  });

  it("returns 404 when file has been deleted", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fakeShareLink);
    (getFileById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get(`/api/public/share/${fakeShareLink.token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("File not found");
  });

  it("returns 500 when service throws", async () => {
    (getShareLinkByToken as jest.Mock).mockRejectedValue(new Error("DB error"));

    const res = await request(app).get(`/api/public/share/${fakeShareLink.token}`);

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("DB error");
  });
});

/* ================================================================== */
/*  GET /api/public/share/:token — folder link                         */
/* ================================================================== */

describe("GET /api/public/share/:token (folder)", () => {
  it("returns 200 with folder metadata and download path", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fakeFolderShareLink);
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);

    const res = await request(app).get(`/api/public/share/${fakeFolderShareLink.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      resourceType: "folder",
      name: rootFolder.name,
      downloadUrl: `/api/public/share/${fakeFolderShareLink.token}/download`,
    });
  });

  it("returns 404 when folder has been deleted", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fakeFolderShareLink);
    (getFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get(`/api/public/share/${fakeFolderShareLink.token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Folder not found");
  });
});

/* ================================================================== */
/*  GET /api/public/share/:token/download — folder zip                 */
/* ================================================================== */

describe("GET /api/public/share/:token/download", () => {
  it("returns 404 when token not found", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get("/api/public/share/nonexistent/download");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Link not found");
  });

  it("returns 410 when link has expired", async () => {
    const expiredFolderLink = { ...fakeFolderShareLink, expires_at: "2020-01-01T00:00:00.000Z" };
    (getShareLinkByToken as jest.Mock).mockResolvedValue(expiredFolderLink);

    const res = await request(app).get(`/api/public/share/${expiredFolderLink.token}/download`);

    expect(res.status).toBe(410);
    expect(res.body.error).toBe("Link has expired");
  });

  it("returns 400 when link is for a file, not a folder", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fakeShareLink);

    const res = await request(app).get(`/api/public/share/${fakeShareLink.token}/download`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Download endpoint is only for folder links");
  });

  it("returns 404 when folder has been deleted", async () => {
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fakeFolderShareLink);
    (getFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get(`/api/public/share/${fakeFolderShareLink.token}/download`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Folder not found");
  });

  it("streams a zip when folder link is valid", async () => {
    const { Readable } = require("stream");
    (getShareLinkByToken as jest.Mock).mockResolvedValue(fakeFolderShareLink);
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (collectFolderFiles as jest.Mock).mockResolvedValue([
      { s3_key: "files/user-1/file-1/test.txt", zipPath: "test.txt" },
    ]);
    (getObjectStream as jest.Mock).mockResolvedValue(Readable.from([Buffer.from("hello")]));

    const res = await request(app).get(`/api/public/share/${fakeFolderShareLink.token}/download`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-disposition"]).toContain(`${rootFolder.name}.zip`);
  });
});

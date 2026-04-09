import request from "supertest";
import { IFile, IFolder, IUser } from "../src/interfaces";

/* ------------------------------------------------------------------ */
/*  Module mocks that must be declared before app import               */
/* ------------------------------------------------------------------ */

jest.mock("uuid", () => ({ v4: () => "mock-uuid" }));

/* ------------------------------------------------------------------ */
/*  Fake data                                                         */
/* ------------------------------------------------------------------ */

const testUser: IUser = {
  id: "user-1111-1111-1111",
  first_name: "Alice",
  last_name: "Anderson",
  username: "alice",
  api_key_prefix: "AAAAAAAA",
  api_key_hash: "$2b$10$fakehash",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const otherUser: IUser = {
  id: "user-2222-2222-2222",
  first_name: "Bob",
  last_name: "Baker",
  username: "bob",
  api_key_prefix: "BBBBBBBB",
  api_key_hash: "$2b$10$fakehash",
  created_at: "2026-01-02T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

const fakeFile: IFile = {
  id: "file-aaaa-aaaa-aaaa",
  user_id: testUser.id,
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

/* ------------------------------------------------------------------ */
/*  Mocks – service layer + middleware                                */
/* ------------------------------------------------------------------ */

jest.mock("../src/middleware/protectedRoute", () => {
  const testUser = {
    id: "user-1111-1111-1111",
    first_name: "Alice",
    last_name: "Anderson",
    username: "alice",
    api_key_prefix: "AAAAAAAA",
    api_key_hash: "$2b$10$fakehash",
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
import { getFolderById } from "../src/services/folderService";
import {
  shareFile,
  unshareFile,
  getFileSharesWithUsers,
  shareFolder,
  unshareFolder,
  getFolderShares,
  getItemsSharedWithUser,
} from "../src/services/sharingService";
import { canAccessFile, canAccessFolder } from "../src/utils/accessControl";
import { getDb } from "../src/db/db";

/* ------------------------------------------------------------------ */
/*  Reset mocks between tests                                         */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  jest.clearAllMocks();
});

/* ================================================================== */
/*  POST /api/files/:id/share – Share file with user                   */
/* ================================================================== */

describe("POST /api/files/:id/share", () => {
  const mockDbInstance = jest.fn();

  beforeEach(() => {
    mockDbInstance.mockReturnValue({
      where: jest.fn().mockReturnValue({
        first: jest.fn(),
      }),
    });
    (getDb as jest.Mock).mockReturnValue(mockDbInstance);
  });

  it("returns 201 when sharing succeeds", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    const targetUserRecord = { id: otherUser.id, username: "bob", first_name: "Bob", last_name: "Baker" };
    const mockUsersFirst = jest.fn().mockResolvedValue(targetUserRecord);
    const mockUsersWhere = jest.fn().mockReturnValue({ first: mockUsersFirst });
    const mockSharesFirst = jest.fn().mockResolvedValue(undefined);
    const mockSharesWhere = jest.fn().mockReturnValue({ first: mockSharesFirst });
    mockDbInstance
      .mockReturnValueOnce({ where: mockUsersWhere })
      .mockReturnValueOnce({ where: mockSharesWhere });
    (shareFile as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app)
      .post(`/api/files/${fakeFile.id}/share`)
      .send({ username: "bob" });

    expect(res.status).toBe(201);
    expect(res.body.sharedWith).toEqual({
      id: otherUser.id,
      username: "bob",
      first_name: "Bob",
      last_name: "Baker",
    });
    expect(shareFile).toHaveBeenCalledWith(fakeFile.id, testUser.id, "bob");
  });

  it("returns 400 when username is missing", async () => {
    const res = await request(app)
      .post(`/api/files/${fakeFile.id}/share`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.errorMsg).toMatch(/username is required/);
  });

  it("returns 400 when username is empty string", async () => {
    const res = await request(app)
      .post(`/api/files/${fakeFile.id}/share`)
      .send({ username: "  " });

    expect(res.status).toBe(400);
    expect(res.body.errorMsg).toMatch(/username is required/);
  });

  it("returns 404 when file does not exist", async () => {
    (getFileById as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/files/${fakeFile.id}/share`)
      .send({ username: "bob" });

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("File not found");
  });

  it("returns 403 when user is not the file owner", async () => {
    (getFileById as jest.Mock).mockResolvedValue(otherUserFile);

    const res = await request(app)
      .post(`/api/files/${otherUserFile.id}/share`)
      .send({ username: "charlie" });

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/Only the file owner/);
  });

  it("returns 404 when target user not found", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    const mockUsersFirst = jest.fn().mockResolvedValue(undefined);
    const mockUsersWhere = jest.fn().mockReturnValue({ first: mockUsersFirst });
    mockDbInstance.mockReturnValueOnce({ where: mockUsersWhere });

    const res = await request(app)
      .post(`/api/files/${fakeFile.id}/share`)
      .send({ username: "ghost" });

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toMatch(/User "ghost" not found/);
  });

  it("returns 409 when file is already shared with user", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    const targetUserRecord = { id: otherUser.id, username: "bob", first_name: "Bob", last_name: "Baker" };
    const mockUsersFirst = jest.fn().mockResolvedValue(targetUserRecord);
    const mockUsersWhere = jest.fn().mockReturnValue({ first: mockUsersFirst });
    const mockSharesFirst = jest.fn().mockResolvedValue({ id: "share-1" });
    const mockSharesWhere = jest.fn().mockReturnValue({ first: mockSharesFirst });
    mockDbInstance
      .mockReturnValueOnce({ where: mockUsersWhere })
      .mockReturnValueOnce({ where: mockSharesWhere });

    const res = await request(app)
      .post(`/api/files/${fakeFile.id}/share`)
      .send({ username: "bob" });

    expect(res.status).toBe(409);
    expect(res.body.errorMsg).toMatch(/already shared/);
  });

  it("returns 500 when shareFile throws", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    const targetUserRecord = { id: otherUser.id, username: "bob", first_name: "Bob", last_name: "Baker" };
    const mockUsersFirst = jest.fn().mockResolvedValue(targetUserRecord);
    const mockUsersWhere = jest.fn().mockReturnValue({ first: mockUsersFirst });
    const mockSharesFirst = jest.fn().mockResolvedValue(undefined);
    const mockSharesWhere = jest.fn().mockReturnValue({ first: mockSharesFirst });
    mockDbInstance
      .mockReturnValueOnce({ where: mockUsersWhere })
      .mockReturnValueOnce({ where: mockSharesWhere });
    (shareFile as jest.Mock).mockRejectedValue(new Error("DB error"));

    const res = await request(app)
      .post(`/api/files/${fakeFile.id}/share`)
      .send({ username: "bob" });

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("DB error");
  });
});

/* ================================================================== */
/*  DELETE /api/files/:id/share/:sharedUserId – Remove file share      */
/* ================================================================== */

describe("DELETE /api/files/:id/share/:sharedUserId", () => {
  it("returns 204 on successful unshare", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (unshareFile as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app).delete(
      `/api/files/${fakeFile.id}/share/${otherUser.id}`
    );

    expect(res.status).toBe(204);
    expect(unshareFile).toHaveBeenCalledWith(fakeFile.id, testUser.id, otherUser.id);
  });

  it("returns 404 when file does not exist", async () => {
    (getFileById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).delete(
      `/api/files/nonexistent/share/${otherUser.id}`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("File not found");
  });

  it("returns 403 when user is not the file owner", async () => {
    (getFileById as jest.Mock).mockResolvedValue(otherUserFile);

    const res = await request(app).delete(
      `/api/files/${otherUserFile.id}/share/${testUser.id}`
    );

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/Only the file owner/);
  });

  it("returns 404 when share does not exist", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (unshareFile as jest.Mock).mockRejectedValue(new Error("File share not found"));

    const res = await request(app).delete(
      `/api/files/${fakeFile.id}/share/${otherUser.id}`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("File share not found");
  });

  it("returns 500 when unshareFile throws unexpected error", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (unshareFile as jest.Mock).mockRejectedValue(new Error("DB connection lost"));

    const res = await request(app).delete(
      `/api/files/${fakeFile.id}/share/${otherUser.id}`
    );

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("DB connection lost");
  });
});

/* ================================================================== */
/*  GET /api/files/:id/shares – List file shares                       */
/* ================================================================== */

describe("GET /api/files/:id/shares", () => {
  it("returns 200 with shared users list", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (getFileSharesWithUsers as jest.Mock).mockResolvedValue([
      { id: otherUser.id, username: "bob", first_name: "Bob", last_name: "Baker", sharedAt: "2026-02-01T00:00:00.000Z" },
    ]);

    const res = await request(app).get(`/api/files/${fakeFile.id}/shares`);

    expect(res.status).toBe(200);
    expect(res.body.sharedWith).toHaveLength(1);
    expect(res.body.sharedWith[0].username).toBe("bob");
    expect(res.body.sharedWith[0].sharedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("returns empty array when no shares exist", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (getFileSharesWithUsers as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get(`/api/files/${fakeFile.id}/shares`);

    expect(res.status).toBe(200);
    expect(res.body.sharedWith).toEqual([]);
  });

  it("returns 404 when file does not exist", async () => {
    (getFileById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get("/api/files/nonexistent/shares");

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("File not found");
  });

  it("returns 403 when user is not the file owner", async () => {
    (getFileById as jest.Mock).mockResolvedValue(otherUserFile);

    const res = await request(app).get(`/api/files/${otherUserFile.id}/shares`);

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/Only the file owner/);
  });

  it("returns 500 when getFileSharesWithUsers throws", async () => {
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (getFileSharesWithUsers as jest.Mock).mockRejectedValue(new Error("DB error"));

    const res = await request(app).get(`/api/files/${fakeFile.id}/shares`);

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("DB error");
  });
});

/* ================================================================== */
/*  POST /api/folders/:id/share – Share folder with user               */
/* ================================================================== */

describe("POST /api/folders/:id/share", () => {
  const mockDbInstance = jest.fn();

  beforeEach(() => {
    mockDbInstance.mockReturnValue({
      where: jest.fn().mockReturnValue({
        first: jest.fn(),
      }),
    });
    (getDb as jest.Mock).mockReturnValue(mockDbInstance);
  });

  it("returns 201 when sharing succeeds", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    const targetUserRecord = { id: otherUser.id, username: "bob", first_name: "Bob", last_name: "Baker" };
    const mockUsersFirst = jest.fn().mockResolvedValue(targetUserRecord);
    const mockUsersWhere = jest.fn().mockReturnValue({ first: mockUsersFirst });
    const mockSharesFirst = jest.fn().mockResolvedValue(undefined);
    const mockSharesWhere = jest.fn().mockReturnValue({ first: mockSharesFirst });
    mockDbInstance
      .mockReturnValueOnce({ where: mockUsersWhere })
      .mockReturnValueOnce({ where: mockSharesWhere });
    (shareFolder as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app)
      .post(`/api/folders/${rootFolder.id}/share`)
      .send({ username: "bob" });

    expect(res.status).toBe(201);
    expect(res.body.sharedWith).toEqual({
      id: otherUser.id,
      username: "bob",
      first_name: "Bob",
      last_name: "Baker",
    });
    expect(shareFolder).toHaveBeenCalledWith(rootFolder.id, testUser.id, "bob");
  });

  it("returns 400 when username is missing", async () => {
    const res = await request(app)
      .post(`/api/folders/${rootFolder.id}/share`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.errorMsg).toMatch(/username is required/);
  });

  it("returns 400 when username is empty string", async () => {
    const res = await request(app)
      .post(`/api/folders/${rootFolder.id}/share`)
      .send({ username: "" });

    expect(res.status).toBe(400);
    expect(res.body.errorMsg).toMatch(/username is required/);
  });

  it("returns 404 when folder does not exist", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/folders/${rootFolder.id}/share`)
      .send({ username: "bob" });

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });

  it("returns 403 when user is not the folder owner", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(otherUserFolder);

    const res = await request(app)
      .post(`/api/folders/${otherUserFolder.id}/share`)
      .send({ username: "charlie" });

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/Only the folder owner/);
  });

  it("returns 404 when target user not found", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    const mockUsersFirst = jest.fn().mockResolvedValue(undefined);
    const mockUsersWhere = jest.fn().mockReturnValue({ first: mockUsersFirst });
    mockDbInstance.mockReturnValueOnce({ where: mockUsersWhere });

    const res = await request(app)
      .post(`/api/folders/${rootFolder.id}/share`)
      .send({ username: "ghost" });

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toMatch(/User "ghost" not found/);
  });

  it("returns 409 when folder is already shared with user", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    const targetUserRecord = { id: otherUser.id, username: "bob", first_name: "Bob", last_name: "Baker" };
    const mockUsersFirst = jest.fn().mockResolvedValue(targetUserRecord);
    const mockUsersWhere = jest.fn().mockReturnValue({ first: mockUsersFirst });
    const mockSharesFirst = jest.fn().mockResolvedValue({ id: "share-1" });
    const mockSharesWhere = jest.fn().mockReturnValue({ first: mockSharesFirst });
    mockDbInstance
      .mockReturnValueOnce({ where: mockUsersWhere })
      .mockReturnValueOnce({ where: mockSharesWhere });

    const res = await request(app)
      .post(`/api/folders/${rootFolder.id}/share`)
      .send({ username: "bob" });

    expect(res.status).toBe(409);
    expect(res.body.errorMsg).toMatch(/already shared/);
  });

  it("returns 500 when shareFolder throws", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    const targetUserRecord = { id: otherUser.id, username: "bob", first_name: "Bob", last_name: "Baker" };
    const mockUsersFirst = jest.fn().mockResolvedValue(targetUserRecord);
    const mockUsersWhere = jest.fn().mockReturnValue({ first: mockUsersFirst });
    const mockSharesFirst = jest.fn().mockResolvedValue(undefined);
    const mockSharesWhere = jest.fn().mockReturnValue({ first: mockSharesFirst });
    mockDbInstance
      .mockReturnValueOnce({ where: mockUsersWhere })
      .mockReturnValueOnce({ where: mockSharesWhere });
    (shareFolder as jest.Mock).mockRejectedValue(new Error("DB error"));

    const res = await request(app)
      .post(`/api/folders/${rootFolder.id}/share`)
      .send({ username: "bob" });

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("DB error");
  });
});

/* ================================================================== */
/*  DELETE /api/folders/:id/share/:sharedUserId – Remove folder share  */
/* ================================================================== */

describe("DELETE /api/folders/:id/share/:sharedUserId", () => {
  it("returns 204 on successful unshare", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (unshareFolder as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app).delete(
      `/api/folders/${rootFolder.id}/share/${otherUser.id}`
    );

    expect(res.status).toBe(204);
    expect(unshareFolder).toHaveBeenCalledWith(rootFolder.id, testUser.id, otherUser.id);
  });

  it("returns 404 when folder does not exist", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).delete(
      `/api/folders/nonexistent/share/${otherUser.id}`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });

  it("returns 403 when user is not the folder owner", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(otherUserFolder);

    const res = await request(app).delete(
      `/api/folders/${otherUserFolder.id}/share/${testUser.id}`
    );

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/Only the folder owner/);
  });

  it("returns 404 when share does not exist", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (unshareFolder as jest.Mock).mockRejectedValue(new Error("Folder share not found"));

    const res = await request(app).delete(
      `/api/folders/${rootFolder.id}/share/${otherUser.id}`
    );

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder share not found");
  });

  it("returns 500 when unshareFolder throws unexpected error", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (unshareFolder as jest.Mock).mockRejectedValue(new Error("DB connection lost"));

    const res = await request(app).delete(
      `/api/folders/${rootFolder.id}/share/${otherUser.id}`
    );

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("DB connection lost");
  });
});

/* ================================================================== */
/*  GET /api/folders/:id/shares – List folder shares                   */
/* ================================================================== */

describe("GET /api/folders/:id/shares", () => {
  const mockDbInstance = jest.fn();

  beforeEach(() => {
    (getDb as jest.Mock).mockReturnValue(mockDbInstance);
  });

  it("returns 200 with shared users list", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (getFolderShares as jest.Mock).mockResolvedValue([
      { shared_with_user_id: otherUser.id, created_at: "2026-02-01T00:00:00.000Z" },
    ]);
    const mockSelect = jest.fn().mockResolvedValue([
      { id: otherUser.id, username: "bob", first_name: "Bob", last_name: "Baker" },
    ]);
    const mockWhereIn = jest.fn().mockReturnValue({ select: mockSelect });
    mockDbInstance.mockReturnValue({ whereIn: mockWhereIn });

    const res = await request(app).get(`/api/folders/${rootFolder.id}/shares`);

    expect(res.status).toBe(200);
    expect(res.body.sharedWith).toHaveLength(1);
    expect(res.body.sharedWith[0].username).toBe("bob");
    expect(res.body.sharedWith[0].sharedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("returns empty array when no shares exist", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (getFolderShares as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get(`/api/folders/${rootFolder.id}/shares`);

    expect(res.status).toBe(200);
    expect(res.body.sharedWith).toEqual([]);
  });

  it("returns 404 when folder does not exist", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get("/api/folders/nonexistent/shares");

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });

  it("returns 403 when user is not the folder owner", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(otherUserFolder);

    const res = await request(app).get(`/api/folders/${otherUserFolder.id}/shares`);

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/Only the folder owner/);
  });

  it("returns 500 when getFolderShares throws", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (getFolderShares as jest.Mock).mockRejectedValue(new Error("DB error"));

    const res = await request(app).get(`/api/folders/${rootFolder.id}/shares`);

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("DB error");
  });
});

/* ================================================================== */
/*  GET /api/shared – List items shared with current user              */
/* ================================================================== */

describe("GET /api/shared", () => {
  it("returns 200 with files and folders shared with the user", async () => {
    (getItemsSharedWithUser as jest.Mock).mockResolvedValue({
      files: [fakeFile],
      folders: [rootFolder],
    });

    const res = await request(app).get("/api/shared");

    expect(res.status).toBe(200);
    expect(res.body.files).toHaveLength(1);
    expect(res.body.files[0].id).toBe(fakeFile.id);
    expect(res.body.folders).toHaveLength(1);
    expect(res.body.folders[0].id).toBe(rootFolder.id);
    expect(getItemsSharedWithUser).toHaveBeenCalledWith(testUser.id);
  });

  it("returns 200 with empty arrays when nothing is shared", async () => {
    (getItemsSharedWithUser as jest.Mock).mockResolvedValue({
      files: [],
      folders: [],
    });

    const res = await request(app).get("/api/shared");

    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([]);
    expect(res.body.folders).toEqual([]);
  });

  it("returns 200 with only files when no folders are shared", async () => {
    (getItemsSharedWithUser as jest.Mock).mockResolvedValue({
      files: [fakeFile],
      folders: [],
    });

    const res = await request(app).get("/api/shared");

    expect(res.status).toBe(200);
    expect(res.body.files).toHaveLength(1);
    expect(res.body.folders).toEqual([]);
  });

  it("returns 200 with only folders when no files are shared", async () => {
    (getItemsSharedWithUser as jest.Mock).mockResolvedValue({
      files: [],
      folders: [rootFolder],
    });

    const res = await request(app).get("/api/shared");

    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([]);
    expect(res.body.folders).toHaveLength(1);
  });

  it("returns 500 when getItemsSharedWithUser throws", async () => {
    (getItemsSharedWithUser as jest.Mock).mockRejectedValue(new Error("DB error"));

    const res = await request(app).get("/api/shared");

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("DB error");
  });
});

/* ================================================================== */
/*  Shared user access verification                                    */
/* ================================================================== */

describe("Shared user can access file via download endpoint", () => {
  it("allows access when canAccessFile returns true (shared user)", async () => {
    const { Readable } = require("stream");
    const contentBuffer = Buffer.from("file content");
    (canAccessFile as jest.Mock).mockResolvedValue(true);
    (getFileById as jest.Mock).mockResolvedValue(otherUserFile);
    const { headObject, getObjectStream } = require("../src/aws/s3Service");
    (headObject as jest.Mock).mockResolvedValue({
      contentLength: contentBuffer.length,
      contentType: otherUserFile.mime_type,
    });
    (getObjectStream as jest.Mock).mockResolvedValue(
      Readable.from([contentBuffer])
    );

    const res = await request(app).get(`/api/files/${otherUserFile.id}/download`);

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
  });

  it("denies access when canAccessFile returns false (no share)", async () => {
    (canAccessFile as jest.Mock).mockResolvedValue(false);

    const res = await request(app).get(`/api/files/${otherUserFile.id}/download`);

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("File not found");
  });
});

describe("Shared user can access folder via folder contents endpoint", () => {
  it("allows access when canAccessFolder returns true (shared user)", async () => {
    (canAccessFolder as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(otherUserFolder);
    const { listFolderContents } = require("../src/services/folderService");
    (listFolderContents as jest.Mock).mockResolvedValue({ subFolders: [], files: [] });

    const res = await request(app).get(`/api/folders/${otherUserFolder.id}`);

    expect(res.status).toBe(200);
    expect(res.body.folder).toEqual(otherUserFolder);
  });

  it("denies access when canAccessFolder returns false (no share)", async () => {
    (canAccessFolder as jest.Mock).mockResolvedValue(false);

    const res = await request(app).get(`/api/folders/${otherUserFolder.id}`);

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });
});

/* ================================================================== */
/*  Owner revokes access – verify unshare prevents further access      */
/* ================================================================== */

describe("Owner revokes access and shared user is denied", () => {
  it("owner unshares file, then shared user cannot access", async () => {
    // Step 1: Owner removes the share
    (getFileById as jest.Mock).mockResolvedValue(fakeFile);
    (unshareFile as jest.Mock).mockResolvedValue(undefined);

    const unshareRes = await request(app).delete(
      `/api/files/${fakeFile.id}/share/${otherUser.id}`
    );

    expect(unshareRes.status).toBe(204);
    expect(unshareFile).toHaveBeenCalledWith(fakeFile.id, testUser.id, otherUser.id);

    // Step 2: Shared user tries to access — canAccessFile returns false
    (canAccessFile as jest.Mock).mockResolvedValue(false);

    const accessRes = await request(app).get(`/api/files/${fakeFile.id}/download`);

    expect(accessRes.status).toBe(404);
    expect(accessRes.body.errorMsg).toBe("File not found");
  });

  it("owner unshares folder, then shared user cannot access", async () => {
    // Step 1: Owner removes the share
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (unshareFolder as jest.Mock).mockResolvedValue(undefined);

    const unshareRes = await request(app).delete(
      `/api/folders/${rootFolder.id}/share/${otherUser.id}`
    );

    expect(unshareRes.status).toBe(204);
    expect(unshareFolder).toHaveBeenCalledWith(rootFolder.id, testUser.id, otherUser.id);

    // Step 2: Shared user tries to access — canAccessFolder returns false
    (canAccessFolder as jest.Mock).mockResolvedValue(false);

    const accessRes = await request(app).get(`/api/folders/${rootFolder.id}`);

    expect(accessRes.status).toBe(404);
    expect(accessRes.body.errorMsg).toBe("Folder not found");
  });
});

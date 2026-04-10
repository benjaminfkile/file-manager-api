import request from "supertest";
import { IFolder, IUser } from "../src/interfaces";
import { Readable } from "stream";

/* ------------------------------------------------------------------ */
/*  Module mocks that must be declared before app import               */
/* ------------------------------------------------------------------ */

// uuid is ESM-only; stub it so Jest can parse filesRouter
jest.mock("uuid", () => ({ v4: () => "mock-uuid" }));

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

const childFolder: IFolder = {
  id: "folder-bbbb-bbbb-bbbb",
  user_id: testUser.id,
  parent_folder_id: rootFolder.id,
  name: "Child Folder",
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-01-02T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

const deletedFolder: IFolder = {
  id: "folder-cccc-cccc-cccc",
  user_id: testUser.id,
  parent_folder_id: null,
  name: "Deleted Folder",
  is_deleted: true,
  deleted_at: "2026-03-01T00:00:00.000Z",
  created_at: "2026-01-03T00:00:00.000Z",
  updated_at: "2026-03-01T00:00:00.000Z",
};

const deletedChildFolder: IFolder = {
  id: "folder-dddd-dddd-dddd",
  user_id: testUser.id,
  parent_folder_id: deletedFolder.id,
  name: "Deleted Child",
  is_deleted: true,
  deleted_at: "2026-03-01T00:00:00.000Z",
  created_at: "2026-01-04T00:00:00.000Z",
  updated_at: "2026-03-01T00:00:00.000Z",
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
import {
  createFolder,
  getFolderById,
  listRootFolders,
  listFolderContents,
  renameFolder,
  softDeleteFolder,
  restoreFolder,
  hardDeleteFolder,
  collectFolderFiles,
  getDeletedFolderById,
} from "../src/services/folderService";
import { shareFolder, unshareFolder, getFolderShares } from "../src/services/sharingService";
import { canAccessFolder } from "../src/utils/accessControl";
import { deleteObjects, getObjectStream } from "../src/aws/s3Service";
import { getDb } from "../src/db/db";

/* ------------------------------------------------------------------ */
/*  Reset mocks between tests                                         */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  jest.clearAllMocks();
});

/* ================================================================== */
/*  POST /api/folders – Create folder                                 */
/* ================================================================== */

describe("POST /api/folders", () => {
  it("creates a root folder and returns 201", async () => {
    (createFolder as jest.Mock).mockResolvedValue(rootFolder);

    const res = await request(app)
      .post("/api/folders")
      .send({ name: "My Folder" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      status: "ok",
      error: false,
      data: rootFolder,
    });
    expect(createFolder).toHaveBeenCalledWith(testUser.id, "My Folder", undefined);
  });

  it("creates a nested folder when parentFolderId is provided", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (createFolder as jest.Mock).mockResolvedValue(childFolder);

    const res = await request(app)
      .post("/api/folders")
      .send({ name: "Child Folder", parentFolderId: rootFolder.id });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(childFolder);
    expect(getFolderById).toHaveBeenCalledWith(rootFolder.id);
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(app)
      .post("/api/folders")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.errorMsg).toMatch(/Folder name is required/);
  });

  it("returns 400 when name is empty string", async () => {
    const res = await request(app)
      .post("/api/folders")
      .send({ name: "   " });

    expect(res.status).toBe(400);
    expect(res.body.errorMsg).toMatch(/Folder name is required/);
  });

  it("returns 400 when name contains path traversal characters", async () => {
    const res = await request(app)
      .post("/api/folders")
      .send({ name: "folder/sub" });

    expect(res.status).toBe(400);
    expect(res.body.errorMsg).toMatch(/path traversal/);
  });

  it("returns 400 for dot name", async () => {
    const res = await request(app)
      .post("/api/folders")
      .send({ name: ".." });

    expect(res.status).toBe(400);
    expect(res.body.errorMsg).toMatch(/path traversal/);
  });

  it("returns 404 when parent folder does not exist", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post("/api/folders")
      .send({ name: "Sub", parentFolderId: "nonexistent-id" });

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Parent folder not found");
  });

  it("returns 403 when parent folder is not owned by user", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(otherUserFolder);

    const res = await request(app)
      .post("/api/folders")
      .send({ name: "Sub", parentFolderId: otherUserFolder.id });

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/do not own/);
  });

  it("returns 500 when service throws", async () => {
    (createFolder as jest.Mock).mockRejectedValue(new Error("DB error"));

    const res = await request(app)
      .post("/api/folders")
      .send({ name: "Oops" });

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("DB error");
  });
});

/* ================================================================== */
/*  GET /api/folders – List root folders                              */
/* ================================================================== */

describe("GET /api/folders", () => {
  it("returns 200 with array of root folders", async () => {
    (listRootFolders as jest.Mock).mockResolvedValue([rootFolder]);

    const res = await request(app).get("/api/folders");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ folders: [rootFolder] });
    expect(listRootFolders).toHaveBeenCalledWith(testUser.id);
  });

  it("returns empty array when user has no folders", async () => {
    (listRootFolders as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get("/api/folders");

    expect(res.status).toBe(200);
    expect(res.body.folders).toEqual([]);
  });

  it("returns 500 when service throws", async () => {
    (listRootFolders as jest.Mock).mockRejectedValue(new Error("fail"));

    const res = await request(app).get("/api/folders");

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("fail");
  });
});

/* ================================================================== */
/*  GET /api/folders/:id – Get folder contents                        */
/* ================================================================== */

describe("GET /api/folders/:id", () => {
  it("returns 200 with folder, subFolders, and files", async () => {
    (canAccessFolder as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (listFolderContents as jest.Mock).mockResolvedValue({
      subFolders: [childFolder],
      files: [],
    });

    const res = await request(app).get(`/api/folders/${rootFolder.id}`);

    expect(res.status).toBe(200);
    expect(res.body.folder).toEqual(rootFolder);
    expect(res.body.subFolders).toEqual([childFolder]);
    expect(res.body.files).toEqual([]);
  });

  it("returns 404 when user has no access", async () => {
    (canAccessFolder as jest.Mock).mockResolvedValue(false);

    const res = await request(app).get(`/api/folders/${otherUserFolder.id}`);

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });

  it("returns 500 when service throws", async () => {
    (canAccessFolder as jest.Mock).mockRejectedValue(new Error("boom"));

    const res = await request(app).get(`/api/folders/${rootFolder.id}`);

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("boom");
  });
});

/* ================================================================== */
/*  PATCH /api/folders/:id – Rename folder                            */
/* ================================================================== */

describe("PATCH /api/folders/:id", () => {
  it("returns 200 with updated folder on valid rename", async () => {
    const renamed = { ...rootFolder, name: "Renamed" };
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (renameFolder as jest.Mock).mockResolvedValue(renamed);

    const res = await request(app)
      .patch(`/api/folders/${rootFolder.id}`)
      .send({ name: "Renamed" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Renamed");
    expect(renameFolder).toHaveBeenCalledWith(rootFolder.id, "Renamed");
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(app)
      .patch(`/api/folders/${rootFolder.id}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.errorMsg).toMatch(/Folder name is required/);
  });

  it("returns 400 for path traversal name", async () => {
    const res = await request(app)
      .patch(`/api/folders/${rootFolder.id}`)
      .send({ name: "bad\\name" });

    expect(res.status).toBe(400);
    expect(res.body.errorMsg).toMatch(/path traversal/);
  });

  it("returns 404 when folder does not exist", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/folders/nonexistent")
      .send({ name: "New Name" });

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });

  it("returns 403 when user is not the owner", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(otherUserFolder);

    const res = await request(app)
      .patch(`/api/folders/${otherUserFolder.id}`)
      .send({ name: "Hijack" });

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toBe("Access denied");
  });
});

/* ================================================================== */
/*  DELETE /api/folders/:id – Soft delete                             */
/* ================================================================== */

describe("DELETE /api/folders/:id", () => {
  it("returns 204 on successful soft delete", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (softDeleteFolder as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app).delete(`/api/folders/${rootFolder.id}`);

    expect(res.status).toBe(204);
    expect(softDeleteFolder).toHaveBeenCalledWith(rootFolder.id);
  });

  it("returns 404 when folder does not exist", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).delete("/api/folders/nonexistent");

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });

  it("returns 403 when user is not the owner", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(otherUserFolder);

    const res = await request(app).delete(`/api/folders/${otherUserFolder.id}`);

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toBe("Access denied");
  });

  it("returns 500 when softDeleteFolder throws", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (softDeleteFolder as jest.Mock).mockRejectedValue(new Error("tx fail"));

    const res = await request(app).delete(`/api/folders/${rootFolder.id}`);

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("tx fail");
  });
});

/* ================================================================== */
/*  POST /api/folders/:id/restore – Restore from recycle bin          */
/* ================================================================== */

describe("POST /api/folders/:id/restore", () => {
  it("returns 200 with restored folder", async () => {
    const restored = { ...deletedFolder, is_deleted: false, deleted_at: null };
    (getDeletedFolderById as jest.Mock).mockResolvedValue(deletedFolder);
    (restoreFolder as jest.Mock).mockResolvedValue(undefined);
    (getFolderById as jest.Mock).mockResolvedValue(restored);

    const res = await request(app).post(`/api/folders/${deletedFolder.id}/restore`);

    expect(res.status).toBe(200);
    expect(res.body.data.is_deleted).toBe(false);
    expect(restoreFolder).toHaveBeenCalledWith(deletedFolder.id);
  });

  it("returns 404 when deleted folder not found", async () => {
    (getDeletedFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).post("/api/folders/nonexistent/restore");

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });

  it("returns 403 when user is not the owner", async () => {
    const otherDeleted = { ...deletedFolder, user_id: otherUser.id };
    (getDeletedFolderById as jest.Mock).mockResolvedValue(otherDeleted);

    const res = await request(app).post(`/api/folders/${deletedFolder.id}/restore`);

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toBe("Access denied");
  });

  it("returns 409 when parent folder is also deleted", async () => {
    (getDeletedFolderById as jest.Mock)
      .mockResolvedValueOnce(deletedChildFolder)  // the folder being restored
      .mockResolvedValueOnce(deletedFolder);       // its parent is also deleted

    const res = await request(app).post(`/api/folders/${deletedChildFolder.id}/restore`);

    expect(res.status).toBe(409);
    expect(res.body.errorMsg).toMatch(/parent folder is also in the recycle bin/);
  });

  it("allows restore when parent folder is NOT deleted", async () => {
    const childWithLiveParent = { ...deletedChildFolder, parent_folder_id: rootFolder.id };
    const restored = { ...childWithLiveParent, is_deleted: false, deleted_at: null };
    (getDeletedFolderById as jest.Mock)
      .mockResolvedValueOnce(childWithLiveParent)  // the folder being restored
      .mockResolvedValueOnce(null);                 // parent is NOT in deleted list
    (restoreFolder as jest.Mock).mockResolvedValue(undefined);
    (getFolderById as jest.Mock).mockResolvedValue(restored);

    const res = await request(app).post(`/api/folders/${deletedChildFolder.id}/restore`);

    expect(res.status).toBe(200);
    expect(res.body.data.is_deleted).toBe(false);
  });
});

/* ================================================================== */
/*  DELETE /api/folders/:id/permanent – Permanent delete              */
/* ================================================================== */

describe("DELETE /api/folders/:id/permanent", () => {
  it("returns 204 on successful permanent delete", async () => {
    (getDeletedFolderById as jest.Mock).mockResolvedValue(deletedFolder);
    (hardDeleteFolder as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app).delete(`/api/folders/${deletedFolder.id}/permanent`);

    expect(res.status).toBe(204);
    expect(hardDeleteFolder).toHaveBeenCalledWith(deletedFolder.id, expect.any(Function));
  });

  it("returns 404 when deleted folder not found", async () => {
    (getDeletedFolderById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).delete("/api/folders/nonexistent/permanent");

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });

  it("returns 403 when user is not the owner", async () => {
    const otherDeleted = { ...deletedFolder, user_id: otherUser.id };
    (getDeletedFolderById as jest.Mock).mockResolvedValue(otherDeleted);

    const res = await request(app).delete(`/api/folders/${deletedFolder.id}/permanent`);

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toBe("Access denied");
  });

  it("returns 500 when hardDeleteFolder throws", async () => {
    (getDeletedFolderById as jest.Mock).mockResolvedValue(deletedFolder);
    (hardDeleteFolder as jest.Mock).mockRejectedValue(new Error("s3 fail"));

    const res = await request(app).delete(`/api/folders/${deletedFolder.id}/permanent`);

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("s3 fail");
  });
});

/* ================================================================== */
/*  GET /api/folders/:id/download – Download folder as zip            */
/* ================================================================== */

describe("GET /api/folders/:id/download", () => {
  it("returns a zip stream with correct headers", async () => {
    (canAccessFolder as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (collectFolderFiles as jest.Mock).mockResolvedValue([
      { s3_key: "key1", zipPath: "file1.txt" },
    ]);
    (getObjectStream as jest.Mock).mockResolvedValue(
      Readable.from(Buffer.from("hello"))
    );

    const res = await request(app).get(`/api/folders/${rootFolder.id}/download`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-disposition"]).toContain("My Folder.zip");
  });

  it("returns zip for empty folder (no files)", async () => {
    (canAccessFolder as jest.Mock).mockResolvedValue(true);
    (getFolderById as jest.Mock).mockResolvedValue(rootFolder);
    (collectFolderFiles as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get(`/api/folders/${rootFolder.id}/download`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
  });

  it("returns 404 when user has no access", async () => {
    (canAccessFolder as jest.Mock).mockResolvedValue(false);

    const res = await request(app).get(`/api/folders/${rootFolder.id}/download`);

    expect(res.status).toBe(404);
    expect(res.body.errorMsg).toBe("Folder not found");
  });
});

/* ================================================================== */
/*  POST /api/folders/:id/share – Share folder                        */
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
    // First db call: users lookup
    const mockUsersFirst = jest.fn().mockResolvedValue(targetUserRecord);
    const mockUsersWhere = jest.fn().mockReturnValue({ first: mockUsersFirst });
    // Second db call: folder_shares existing check
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
    expect(res.body.sharedWith.username).toBe("bob");
  });

  it("returns 400 when username is missing", async () => {
    const res = await request(app)
      .post(`/api/folders/${rootFolder.id}/share`)
      .send({});

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

  it("returns 403 when user is not the owner", async () => {
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

  it("returns 409 when share already exists", async () => {
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
});

/* ================================================================== */
/*  GET /api/folders/:id/shares – List folder shares                  */
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
  });

  it("returns 403 when user is not the owner", async () => {
    (getFolderById as jest.Mock).mockResolvedValue(otherUserFolder);

    const res = await request(app).get(`/api/folders/${otherUserFolder.id}/shares`);

    expect(res.status).toBe(403);
    expect(res.body.errorMsg).toMatch(/Only the folder owner/);
  });
});

/* ================================================================== */
/*  DELETE /api/folders/:id/share/:sharedUserId – Remove share        */
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
  });

  it("returns 403 when user is not the owner", async () => {
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
});

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
  cognito_sub: "cognito-sub-aaaa",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const deletedFolder: IFolder = {
  id: "folder-aaaa-aaaa-aaaa",
  user_id: testUser.id,
  parent_folder_id: null,
  name: "Old Projects",
  is_deleted: true,
  deleted_at: "2026-03-15T00:00:00.000Z",
  created_at: "2026-02-01T00:00:00.000Z",
  updated_at: "2026-03-15T00:00:00.000Z",
};

const deletedFile: IFile = {
  id: "file-bbbb-bbbb-bbbb",
  user_id: testUser.id,
  folder_id: "folder-aaaa-aaaa-aaaa",
  name: "old-doc.txt",
  s3_key: "files/user-1111-1111-1111/file-bbbb-bbbb-bbbb/old-doc.txt",
  size_bytes: 512,
  mime_type: "text/plain",
  is_deleted: true,
  deleted_at: "2026-03-15T00:00:00.000Z",
  created_at: "2026-03-01T00:00:00.000Z",
  updated_at: "2026-03-15T00:00:00.000Z",
};

const deletedFile2: IFile = {
  id: "file-cccc-cccc-cccc",
  user_id: testUser.id,
  folder_id: null,
  name: "backup.zip",
  s3_key: "files/user-1111-1111-1111/file-cccc-cccc-cccc/backup.zip",
  size_bytes: 4096,
  mime_type: "application/zip",
  is_deleted: true,
  deleted_at: "2026-03-20T00:00:00.000Z",
  created_at: "2026-03-10T00:00:00.000Z",
  updated_at: "2026-03-20T00:00:00.000Z",
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

jest.mock("../src/services/fileService");
jest.mock("../src/services/folderService");
jest.mock("../src/aws/s3Service");

/* ---- DB mock with transaction + pluck support ---- */
const mockTrx: any = jest.fn().mockReturnValue({
  where: jest.fn().mockReturnValue({
    update: jest.fn().mockResolvedValue(0),
    del: jest.fn().mockResolvedValue(0),
  }),
});

const mockDbInstance: any = jest.fn().mockReturnValue({
  where: jest.fn().mockReturnValue({
    first: jest.fn(),
    pluck: jest.fn().mockResolvedValue([]),
  }),
  transaction: jest.fn((cb: any) => cb(mockTrx)),
});

jest.mock("../src/db/db", () => ({
  getDb: jest.fn().mockImplementation(() => mockDbInstance),
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

import { listDeletedFiles } from "../src/services/fileService";
import { listDeletedFolders } from "../src/services/folderService";
import { deleteObjects } from "../src/aws/s3Service";
import { getDb } from "../src/db/db";

/* ------------------------------------------------------------------ */
/*  Reset mocks between tests                                         */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  jest.clearAllMocks();

  /* Reset default mock implementations */
  mockDbInstance.mockReturnValue({
    where: jest.fn().mockReturnValue({
      first: jest.fn(),
      pluck: jest.fn().mockResolvedValue([]),
    }),
    transaction: jest.fn((cb: any) => cb(mockTrx)),
  });

  mockTrx.mockReturnValue({
    where: jest.fn().mockReturnValue({
      update: jest.fn().mockResolvedValue(0),
      del: jest.fn().mockResolvedValue(0),
    }),
  });

  (getDb as jest.Mock).mockReturnValue(mockDbInstance);
});

/* ================================================================== */
/*  GET /api/recycle-bin                                               */
/* ================================================================== */

describe("GET /api/recycle-bin", () => {
  it("returns 200 with deleted folders and files", async () => {
    (listDeletedFolders as jest.Mock).mockResolvedValue([deletedFolder]);
    (listDeletedFiles as jest.Mock).mockResolvedValue([deletedFile, deletedFile2]);

    const res = await request(app).get("/api/recycle-bin");

    expect(res.status).toBe(200);
    expect(res.body.folders).toEqual([deletedFolder]);
    expect(res.body.files).toEqual([deletedFile, deletedFile2]);
    expect(listDeletedFolders).toHaveBeenCalledWith(testUser.id);
    expect(listDeletedFiles).toHaveBeenCalledWith(testUser.id);
  });

  it("returns 200 with empty arrays when recycle bin is empty", async () => {
    (listDeletedFolders as jest.Mock).mockResolvedValue([]);
    (listDeletedFiles as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get("/api/recycle-bin");

    expect(res.status).toBe(200);
    expect(res.body.folders).toEqual([]);
    expect(res.body.files).toEqual([]);
  });

  it("returns 500 when listDeletedFolders throws", async () => {
    (listDeletedFolders as jest.Mock).mockRejectedValue(new Error("DB error"));
    (listDeletedFiles as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get("/api/recycle-bin");

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("Failed to list recycle bin contents.");
  });

  it("returns 500 when listDeletedFiles throws", async () => {
    (listDeletedFolders as jest.Mock).mockResolvedValue([]);
    (listDeletedFiles as jest.Mock).mockRejectedValue(new Error("DB error"));

    const res = await request(app).get("/api/recycle-bin");

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("Failed to list recycle bin contents.");
  });
});

/* ================================================================== */
/*  POST /api/recycle-bin/restore-all                                  */
/* ================================================================== */

describe("POST /api/recycle-bin/restore-all", () => {
  it("returns 200 with counts of restored folders and files", async () => {
    const mockFoldersUpdate = jest.fn().mockResolvedValue(2);
    const mockFilesUpdate = jest.fn().mockResolvedValue(3);
    const mockFoldersWhere = jest.fn().mockReturnValue({ update: mockFoldersUpdate });
    const mockFilesWhere = jest.fn().mockReturnValue({ update: mockFilesUpdate });

    mockTrx
      .mockReturnValueOnce({ where: mockFoldersWhere })
      .mockReturnValueOnce({ where: mockFilesWhere });

    const mockTransaction = jest.fn((cb: any) => cb(mockTrx));
    mockDbInstance.transaction = mockTransaction;
    (getDb as jest.Mock).mockReturnValue(mockDbInstance);

    const res = await request(app).post("/api/recycle-bin/restore-all");

    expect(res.status).toBe(200);
    expect(res.body.restoredFolders).toBe(2);
    expect(res.body.restoredFiles).toBe(3);
    expect(mockFoldersWhere).toHaveBeenCalledWith({
      user_id: testUser.id,
      is_deleted: true,
    });
    expect(mockFilesWhere).toHaveBeenCalledWith({
      user_id: testUser.id,
      is_deleted: true,
    });
  });

  it("returns 200 with zero counts when nothing to restore", async () => {
    const mockFoldersUpdate = jest.fn().mockResolvedValue(0);
    const mockFilesUpdate = jest.fn().mockResolvedValue(0);
    const mockFoldersWhere = jest.fn().mockReturnValue({ update: mockFoldersUpdate });
    const mockFilesWhere = jest.fn().mockReturnValue({ update: mockFilesUpdate });

    mockTrx
      .mockReturnValueOnce({ where: mockFoldersWhere })
      .mockReturnValueOnce({ where: mockFilesWhere });

    const mockTransaction = jest.fn((cb: any) => cb(mockTrx));
    mockDbInstance.transaction = mockTransaction;
    (getDb as jest.Mock).mockReturnValue(mockDbInstance);

    const res = await request(app).post("/api/recycle-bin/restore-all");

    expect(res.status).toBe(200);
    expect(res.body.restoredFolders).toBe(0);
    expect(res.body.restoredFiles).toBe(0);
  });

  it("returns 500 when transaction throws", async () => {
    const mockTransaction = jest.fn().mockRejectedValue(new Error("TX error"));
    mockDbInstance.transaction = mockTransaction;
    (getDb as jest.Mock).mockReturnValue(mockDbInstance);

    const res = await request(app).post("/api/recycle-bin/restore-all");

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("Failed to restore all items.");
  });
});

/* ================================================================== */
/*  DELETE /api/recycle-bin/empty                                       */
/* ================================================================== */

describe("DELETE /api/recycle-bin/empty", () => {
  it("returns 204 and calls deleteObjects with S3 keys", async () => {
    const s3Keys = [deletedFile.s3_key, deletedFile2.s3_key];
    const mockPluck = jest.fn().mockResolvedValue(s3Keys);
    const mockFilesWhere = jest.fn().mockReturnValue({ pluck: mockPluck });
    mockDbInstance.mockReturnValue({ where: mockFilesWhere });

    const mockFilesDel = jest.fn().mockResolvedValue(2);
    const mockFoldersDel = jest.fn().mockResolvedValue(1);
    const mockTrxFilesWhere = jest.fn().mockReturnValue({ del: mockFilesDel });
    const mockTrxFoldersWhere = jest.fn().mockReturnValue({ del: mockFoldersDel });

    mockTrx
      .mockReturnValueOnce({ where: mockTrxFilesWhere })
      .mockReturnValueOnce({ where: mockTrxFoldersWhere });

    const mockTransaction = jest.fn((cb: any) => cb(mockTrx));
    mockDbInstance.transaction = mockTransaction;
    (getDb as jest.Mock).mockReturnValue(mockDbInstance);
    (deleteObjects as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app).delete("/api/recycle-bin/empty");

    expect(res.status).toBe(204);
    expect(deleteObjects).toHaveBeenCalledWith(s3Keys);
    expect(mockFilesWhere).toHaveBeenCalledWith({
      user_id: testUser.id,
      is_deleted: true,
    });
    expect(mockTrxFilesWhere).toHaveBeenCalledWith({
      user_id: testUser.id,
      is_deleted: true,
    });
    expect(mockTrxFoldersWhere).toHaveBeenCalledWith({
      user_id: testUser.id,
      is_deleted: true,
    });
  });

  it("calls deleteObjects with empty array when no deleted files exist", async () => {
    const mockPluck = jest.fn().mockResolvedValue([]);
    const mockFilesWhere = jest.fn().mockReturnValue({ pluck: mockPluck });
    mockDbInstance.mockReturnValue({ where: mockFilesWhere });

    const mockFilesDel = jest.fn().mockResolvedValue(0);
    const mockFoldersDel = jest.fn().mockResolvedValue(0);
    const mockTrxFilesWhere = jest.fn().mockReturnValue({ del: mockFilesDel });
    const mockTrxFoldersWhere = jest.fn().mockReturnValue({ del: mockFoldersDel });

    mockTrx
      .mockReturnValueOnce({ where: mockTrxFilesWhere })
      .mockReturnValueOnce({ where: mockTrxFoldersWhere });

    const mockTransaction = jest.fn((cb: any) => cb(mockTrx));
    mockDbInstance.transaction = mockTransaction;
    (getDb as jest.Mock).mockReturnValue(mockDbInstance);
    (deleteObjects as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app).delete("/api/recycle-bin/empty");

    expect(res.status).toBe(204);
    expect(deleteObjects).toHaveBeenCalledWith([]);
  });

  it("returns 500 when deleteObjects throws", async () => {
    const mockPluck = jest.fn().mockResolvedValue([deletedFile.s3_key]);
    const mockFilesWhere = jest.fn().mockReturnValue({ pluck: mockPluck });
    mockDbInstance.mockReturnValue({ where: mockFilesWhere });
    (getDb as jest.Mock).mockReturnValue(mockDbInstance);
    (deleteObjects as jest.Mock).mockRejectedValue(new Error("S3 batch fail"));

    const res = await request(app).delete("/api/recycle-bin/empty");

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("Failed to empty recycle bin.");
  });

  it("returns 500 when transaction throws", async () => {
    const mockPluck = jest.fn().mockResolvedValue([]);
    const mockFilesWhere = jest.fn().mockReturnValue({ pluck: mockPluck });
    mockDbInstance.mockReturnValue({ where: mockFilesWhere });

    const mockTransaction = jest.fn().mockRejectedValue(new Error("TX error"));
    mockDbInstance.transaction = mockTransaction;
    (getDb as jest.Mock).mockReturnValue(mockDbInstance);
    (deleteObjects as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app).delete("/api/recycle-bin/empty");

    expect(res.status).toBe(500);
    expect(res.body.errorMsg).toBe("Failed to empty recycle bin.");
  });
});

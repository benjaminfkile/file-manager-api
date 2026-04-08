import { IFolder, IFile } from "../src/interfaces";

/* ------------------------------------------------------------------ */
/*  Mock the knex DB client                                           */
/* ------------------------------------------------------------------ */

const mockQueryBuilder: Record<string, jest.Mock> = {
  where: jest.fn().mockReturnThis(),
  whereIn: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  first: jest.fn(),
  select: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  join: jest.fn().mockReturnThis(),
  del: jest.fn(),
};

// Transaction builder mirrors the query builder
const mockTrxBuilder: Record<string, jest.Mock> = {
  whereIn: jest.fn().mockReturnThis(),
  update: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
};

const mockTrx = jest.fn((): any => mockTrxBuilder);

const mockDb = jest.fn((): any => mockQueryBuilder) as jest.Mock & {
  raw: jest.Mock;
  fn: { now: jest.Mock };
  transaction: jest.Mock;
};
mockDb.raw = jest.fn();
mockDb.fn = { now: jest.fn(() => "NOW()") };
mockDb.transaction = jest.fn(async (cb: (trx: any) => Promise<void>) => {
  await cb(mockTrx);
});

jest.mock("../src/db/db", () => ({
  getDb: jest.fn(() => mockDb),
}));

/* ------------------------------------------------------------------ */
/*  Import after mocks are in place                                   */
/* ------------------------------------------------------------------ */

import {
  createFolder,
  softDeleteFolder,
  restoreFolder,
  hardDeleteFolder,
} from "../src/services/folderService";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const fakeFolder: IFolder = {
  id: "folder-1",
  user_id: "user-1",
  parent_folder_id: null,
  name: "My Folder",
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-04-08T00:00:00.000Z",
  updated_at: "2026-04-08T00:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();

  // Re-wire chainable methods after clearAllMocks
  mockQueryBuilder.where.mockReturnThis();
  mockQueryBuilder.whereIn.mockReturnThis();
  mockQueryBuilder.andWhere.mockReturnThis();
  mockQueryBuilder.insert.mockReturnThis();
  mockQueryBuilder.update.mockReturnThis();
  mockQueryBuilder.select.mockReturnThis();
  mockQueryBuilder.orderBy.mockReturnThis();
  mockQueryBuilder.join.mockReturnThis();

  mockTrxBuilder.whereIn.mockReturnThis();
  mockTrxBuilder.update.mockResolvedValue(undefined);
  mockTrxBuilder.del.mockResolvedValue(undefined);

  mockDb.transaction.mockImplementation(async (cb: (trx: any) => Promise<void>) => {
    await cb(mockTrx);
  });
});

/* ================================================================== */
/*  createFolder                                                      */
/* ================================================================== */

describe("createFolder", () => {
  it("creates a root folder (no parent)", async () => {
    mockQueryBuilder.returning.mockResolvedValueOnce([fakeFolder]);

    const result = await createFolder("user-1", "My Folder");

    expect(mockDb).toHaveBeenCalledWith("folders");
    expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
      user_id: "user-1",
      name: "My Folder",
      parent_folder_id: null,
    });
    expect(mockQueryBuilder.returning).toHaveBeenCalledWith("*");
    expect(result).toEqual(fakeFolder);
  });

  it("creates a nested folder with a parent", async () => {
    const nestedFolder: IFolder = {
      ...fakeFolder,
      id: "folder-2",
      parent_folder_id: "folder-1",
      name: "Subfolder",
    };
    mockQueryBuilder.returning.mockResolvedValueOnce([nestedFolder]);

    const result = await createFolder("user-1", "Subfolder", "folder-1");

    expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
      user_id: "user-1",
      name: "Subfolder",
      parent_folder_id: "folder-1",
    });
    expect(result).toEqual(nestedFolder);
  });
});

/* ================================================================== */
/*  softDeleteFolder                                                  */
/* ================================================================== */

describe("softDeleteFolder", () => {
  it("marks the folder, all descendant folders, and their files as deleted", async () => {
    // collectDescendantIds returns the root + one child
    mockDb.raw.mockResolvedValueOnce({
      rows: [{ id: "folder-1" }, { id: "folder-child" }],
    });

    await softDeleteFolder("folder-1");

    // Collected descendants via recursive CTE
    expect(mockDb.raw).toHaveBeenCalledWith(
      expect.stringContaining("WITH RECURSIVE tree AS"),
      ["folder-1"]
    );

    // Transaction was used
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);

    // Two calls inside the transaction: one for folders, one for files
    expect(mockTrx).toHaveBeenCalledWith("folders");
    expect(mockTrx).toHaveBeenCalledWith("files");

    // Both update calls used the full descendant id list
    expect(mockTrxBuilder.whereIn).toHaveBeenCalledWith("id", [
      "folder-1",
      "folder-child",
    ]);
    expect(mockTrxBuilder.whereIn).toHaveBeenCalledWith("folder_id", [
      "folder-1",
      "folder-child",
    ]);

    // Marked as deleted
    expect(mockTrxBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_deleted: true })
    );
    expect(mockTrxBuilder.update).toHaveBeenCalledTimes(2);
  });

  it("handles a single folder with no children", async () => {
    mockDb.raw.mockResolvedValueOnce({
      rows: [{ id: "folder-1" }],
    });

    await softDeleteFolder("folder-1");

    expect(mockTrxBuilder.whereIn).toHaveBeenCalledWith("id", ["folder-1"]);
    expect(mockTrxBuilder.whereIn).toHaveBeenCalledWith("folder_id", ["folder-1"]);
  });
});

/* ================================================================== */
/*  restoreFolder                                                     */
/* ================================================================== */

describe("restoreFolder", () => {
  it("recursively restores descendant folders and files", async () => {
    mockDb.raw.mockResolvedValueOnce({
      rows: [{ id: "folder-1" }, { id: "folder-child" }],
    });

    await restoreFolder("folder-1");

    // Collected descendants
    expect(mockDb.raw).toHaveBeenCalledWith(
      expect.stringContaining("WITH RECURSIVE tree AS"),
      ["folder-1"]
    );

    // Transaction was used
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);

    // Folders restored
    expect(mockTrx).toHaveBeenCalledWith("folders");
    expect(mockTrx).toHaveBeenCalledWith("files");

    expect(mockTrxBuilder.whereIn).toHaveBeenCalledWith("id", [
      "folder-1",
      "folder-child",
    ]);
    expect(mockTrxBuilder.whereIn).toHaveBeenCalledWith("folder_id", [
      "folder-1",
      "folder-child",
    ]);

    // Restored (is_deleted false, deleted_at null)
    expect(mockTrxBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_deleted: false, deleted_at: null })
    );
    expect(mockTrxBuilder.update).toHaveBeenCalledTimes(2);
  });

  it("handles a single folder with no children", async () => {
    mockDb.raw.mockResolvedValueOnce({
      rows: [{ id: "folder-1" }],
    });

    await restoreFolder("folder-1");

    expect(mockTrxBuilder.whereIn).toHaveBeenCalledWith("id", ["folder-1"]);
    expect(mockTrxBuilder.whereIn).toHaveBeenCalledWith("folder_id", ["folder-1"]);
    expect(mockTrxBuilder.update).toHaveBeenCalledTimes(2);
  });
});

/* ================================================================== */
/*  hardDeleteFolder                                                  */
/* ================================================================== */

describe("hardDeleteFolder", () => {
  it("deletes rows from DB and calls s3DeleteFn with all file keys", async () => {
    const mockS3Delete = jest.fn().mockResolvedValue(undefined);

    // collectDescendantIds
    mockDb.raw.mockResolvedValueOnce({
      rows: [{ id: "folder-1" }, { id: "folder-child" }],
    });

    // Gather S3 keys query
    mockQueryBuilder.select.mockResolvedValueOnce([
      { s3_key: "key-a" },
      { s3_key: "key-b" },
      { s3_key: "key-c" },
    ]);

    await hardDeleteFolder("folder-1", mockS3Delete);

    // Collected descendants
    expect(mockDb.raw).toHaveBeenCalledWith(
      expect.stringContaining("WITH RECURSIVE tree AS"),
      ["folder-1"]
    );

    // Gathered S3 keys from files in descendant folders
    expect(mockDb).toHaveBeenCalledWith("files");
    expect(mockQueryBuilder.whereIn).toHaveBeenCalledWith("folder_id", [
      "folder-1",
      "folder-child",
    ]);
    expect(mockQueryBuilder.select).toHaveBeenCalledWith("s3_key");

    // Transaction: deleted files first, then folders
    expect(mockTrx).toHaveBeenCalledWith("files");
    expect(mockTrx).toHaveBeenCalledWith("folders");
    expect(mockTrxBuilder.del).toHaveBeenCalledTimes(2);

    // S3 delete called with all keys
    expect(mockS3Delete).toHaveBeenCalledWith(["key-a", "key-b", "key-c"]);
  });

  it("skips s3DeleteFn when there are no files", async () => {
    const mockS3Delete = jest.fn().mockResolvedValue(undefined);

    mockDb.raw.mockResolvedValueOnce({
      rows: [{ id: "folder-1" }],
    });

    // No files found
    mockQueryBuilder.select.mockResolvedValueOnce([]);

    await hardDeleteFolder("folder-1", mockS3Delete);

    // DB rows still deleted
    expect(mockTrxBuilder.del).toHaveBeenCalledTimes(2);

    // S3 delete NOT called
    expect(mockS3Delete).not.toHaveBeenCalled();
  });

  it("deletes all descendant files from S3 across nested folders", async () => {
    const mockS3Delete = jest.fn().mockResolvedValue(undefined);

    // Three-level deep folder tree
    mockDb.raw.mockResolvedValueOnce({
      rows: [
        { id: "root" },
        { id: "child-1" },
        { id: "child-2" },
        { id: "grandchild-1" },
      ],
    });

    mockQueryBuilder.select.mockResolvedValueOnce([
      { s3_key: "uploads/a.pdf" },
      { s3_key: "uploads/b.pdf" },
    ]);

    await hardDeleteFolder("root", mockS3Delete);

    expect(mockQueryBuilder.whereIn).toHaveBeenCalledWith("folder_id", [
      "root",
      "child-1",
      "child-2",
      "grandchild-1",
    ]);
    expect(mockS3Delete).toHaveBeenCalledWith([
      "uploads/a.pdf",
      "uploads/b.pdf",
    ]);
  });
});

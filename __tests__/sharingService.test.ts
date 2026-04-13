import { IFile, IFileShare, IFolder, IFolderShare } from "../src/interfaces";

/* ------------------------------------------------------------------ */
/*  Mock the knex DB client                                           */
/* ------------------------------------------------------------------ */

const mockQueryBuilder: Record<string, jest.Mock> = {
  where: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  first: jest.fn(),
  del: jest.fn(),
  join: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  select: jest.fn(),
  orderBy: jest.fn(),
};

const mockDb = jest.fn((): any => mockQueryBuilder) as jest.Mock;

jest.mock("../src/db/db", () => ({
  getDb: jest.fn(() => mockDb),
}));

/* ------------------------------------------------------------------ */
/*  Import after mocks are in place                                   */
/* ------------------------------------------------------------------ */

import {
  shareFile,
  unshareFile,
  shareFolder,
  getItemsSharedWithUser,
} from "../src/services/sharingService";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const fakeFileShare: IFileShare = {
  id: "fs-1",
  file_id: "file-1",
  owner_user_id: "owner-1",
  shared_with_user_id: "user-2",
  created_at: "2026-04-08T00:00:00.000Z",
};

const fakeFolderShare: IFolderShare = {
  id: "fls-1",
  folder_id: "folder-1",
  owner_user_id: "owner-1",
  shared_with_user_id: "user-2",
  created_at: "2026-04-08T00:00:00.000Z",
};

const fakeFile: IFile = {
  id: "file-1",
  user_id: "owner-1",
  folder_id: "folder-1",
  name: "report.pdf",
  s3_key: "files/owner-1/file-1/report.pdf",
  size_bytes: 1024,
  mime_type: "application/pdf",
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-04-08T00:00:00.000Z",
  updated_at: "2026-04-08T00:00:00.000Z",
};

const fakeFolder: IFolder = {
  id: "folder-1",
  user_id: "owner-1",
  parent_folder_id: null,
  name: "Documents",
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-04-08T00:00:00.000Z",
  updated_at: "2026-04-08T00:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();

  // Re-wire chainable methods after clearAllMocks
  mockQueryBuilder.where.mockReturnThis();
  mockQueryBuilder.insert.mockReturnThis();
  mockQueryBuilder.join.mockReturnThis();
  mockQueryBuilder.andWhere.mockReturnThis();
});

/* ================================================================== */
/*  shareFile                                                         */
/* ================================================================== */

describe("shareFile", () => {
  it("shares a file with another user (happy path)", async () => {
    // First call: look up target user by username
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: "user-2",
      username: "janedoe",
    });
    // Second call: insert the share and return it
    mockQueryBuilder.returning.mockResolvedValueOnce([fakeFileShare]);

    const result = await shareFile("file-1", "owner-1", "janedoe");

    // Looked up the target user
    expect(mockDb).toHaveBeenCalledWith("users");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith({
      username: "janedoe",
    });

    // Inserted into file_shares
    expect(mockDb).toHaveBeenCalledWith("file_shares");
    expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
      file_id: "file-1",
      owner_user_id: "owner-1",
      shared_with_user_id: "user-2",
    });
    expect(mockQueryBuilder.returning).toHaveBeenCalledWith("*");
    expect(result).toEqual(fakeFileShare);
  });

  it("throws when the target user does not exist", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(undefined);

    await expect(shareFile("file-1", "owner-1", "ghost")).rejects.toThrow(
      'User "ghost" not found'
    );

    expect(mockQueryBuilder.insert).not.toHaveBeenCalled();
  });

  it("throws when sharing a file with yourself", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: "owner-1",
      username: "myself",
    });

    await expect(
      shareFile("file-1", "owner-1", "myself")
    ).rejects.toThrow("Cannot share a file with yourself");

    expect(mockQueryBuilder.insert).not.toHaveBeenCalled();
  });

  it("propagates a duplicate-share database conflict", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: "user-2",
      username: "janedoe",
    });
    mockQueryBuilder.returning.mockRejectedValueOnce(
      new Error("duplicate key value violates unique constraint")
    );

    await expect(
      shareFile("file-1", "owner-1", "janedoe")
    ).rejects.toThrow("duplicate key value violates unique constraint");
  });
});

/* ================================================================== */
/*  unshareFile                                                       */
/* ================================================================== */

describe("unshareFile", () => {
  it("removes an existing file share", async () => {
    mockQueryBuilder.del.mockResolvedValueOnce(1);

    await unshareFile("file-1", "owner-1", "user-2");

    expect(mockDb).toHaveBeenCalledWith("file_shares");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith({
      file_id: "file-1",
      owner_user_id: "owner-1",
      shared_with_user_id: "user-2",
    });
    expect(mockQueryBuilder.del).toHaveBeenCalledTimes(1);
  });

  it("throws when the share does not exist", async () => {
    mockQueryBuilder.del.mockResolvedValueOnce(0);

    await expect(
      unshareFile("file-1", "owner-1", "user-999")
    ).rejects.toThrow("File share not found");
  });
});

/* ================================================================== */
/*  shareFolder                                                       */
/* ================================================================== */

describe("shareFolder", () => {
  it("shares a folder with another user (happy path)", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: "user-2",
      username: "janedoe",
    });
    mockQueryBuilder.returning.mockResolvedValueOnce([fakeFolderShare]);

    const result = await shareFolder("folder-1", "owner-1", "janedoe");

    expect(mockDb).toHaveBeenCalledWith("users");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith({
      username: "janedoe",
    });

    expect(mockDb).toHaveBeenCalledWith("folder_shares");
    expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
      folder_id: "folder-1",
      owner_user_id: "owner-1",
      shared_with_user_id: "user-2",
    });
    expect(mockQueryBuilder.returning).toHaveBeenCalledWith("*");
    expect(result).toEqual(fakeFolderShare);
  });

  it("throws when the target user does not exist", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(undefined);

    await expect(
      shareFolder("folder-1", "owner-1", "ghost")
    ).rejects.toThrow('User "ghost" not found');

    expect(mockQueryBuilder.insert).not.toHaveBeenCalled();
  });

  it("throws when sharing a folder with yourself", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: "owner-1",
      username: "myself",
    });

    await expect(
      shareFolder("folder-1", "owner-1", "myself")
    ).rejects.toThrow("Cannot share a folder with yourself");

    expect(mockQueryBuilder.insert).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/*  getItemsSharedWithUser                                            */
/* ================================================================== */

describe("getItemsSharedWithUser", () => {
  it("returns files and folders shared with the user", async () => {
    const rawFile = { ...fakeFile, shared_by_username: "janedoe", shared_by_first_name: "Jane", shared_by_last_name: "Doe" };
    const rawFolder = { ...fakeFolder, shared_by_username: "janedoe", shared_by_first_name: "Jane", shared_by_last_name: "Doe" };

    // First select() call returns shared files
    mockQueryBuilder.select.mockResolvedValueOnce([rawFile]);
    // Second select() call returns shared folders
    mockQueryBuilder.select.mockResolvedValueOnce([rawFolder]);

    const result = await getItemsSharedWithUser("user-2");

    // Files query
    expect(mockDb).toHaveBeenCalledWith("files");
    expect(mockQueryBuilder.join).toHaveBeenCalledWith(
      "file_shares",
      "files.id",
      "file_shares.file_id"
    );

    // Folders query
    expect(mockDb).toHaveBeenCalledWith("folders");
    expect(mockQueryBuilder.join).toHaveBeenCalledWith(
      "folder_shares",
      "folders.id",
      "folder_shares.folder_id"
    );

    expect(result).toEqual({
      files: [{ ...fakeFile, shared_by: { username: "janedoe", first_name: "Jane", last_name: "Doe" } }],
      folders: [{ ...fakeFolder, shared_by: { username: "janedoe", first_name: "Jane", last_name: "Doe" } }],
    });
  });

  it("returns empty arrays when nothing is shared", async () => {
    mockQueryBuilder.select.mockResolvedValueOnce([]);
    mockQueryBuilder.select.mockResolvedValueOnce([]);

    const result = await getItemsSharedWithUser("user-lonely");

    expect(result).toEqual({ files: [], folders: [] });
  });
});

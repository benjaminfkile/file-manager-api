import { IShareLink } from "../src/interfaces";

/* ------------------------------------------------------------------ */
/*  Mock the knex DB client                                           */
/* ------------------------------------------------------------------ */

const mockQueryBuilder: Record<string, jest.Mock> = {
  where: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  first: jest.fn(),
  del: jest.fn(),
  whereRaw: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
};

const mockDb = jest.fn((): any => mockQueryBuilder) as jest.Mock;

jest.mock("../src/db/db", () => ({
  getDb: jest.fn(() => mockDb),
}));

/* ------------------------------------------------------------------ */
/*  Import after mocks are in place                                   */
/* ------------------------------------------------------------------ */

import {
  createShareLink,
  findShareLinkByToken,
  getShareLinkForFile,
  revokeShareLink,
} from "../src/services/shareLinkService";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const fakeFileLink: IShareLink = {
  id: "link-1",
  token: "a".repeat(64),
  file_id: "file-1",
  folder_id: null,
  created_by_user_id: "user-1",
  expires_at: "2027-01-01T00:00:00.000Z",
  created_at: "2026-04-08T00:00:00.000Z",
};

const fakeFolderLink: IShareLink = {
  id: "link-2",
  token: "b".repeat(64),
  file_id: null,
  folder_id: "folder-1",
  created_by_user_id: "user-1",
  expires_at: null,
  created_at: "2026-04-08T00:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();

  // Re-wire chainable methods after clearAllMocks
  mockQueryBuilder.where.mockReturnThis();
  mockQueryBuilder.insert.mockReturnThis();
  mockQueryBuilder.whereRaw.mockReturnThis();
  mockQueryBuilder.orderBy.mockReturnThis();
});

/* ================================================================== */
/*  createShareLink                                                    */
/* ================================================================== */

describe("createShareLink", () => {
  it("creates a file link with correct row and 64-char hex token", async () => {
    mockQueryBuilder.del.mockResolvedValueOnce(1);
    mockQueryBuilder.returning.mockResolvedValueOnce([fakeFileLink]);

    const result = await createShareLink("user-1", { fileId: "file-1" }, 3600);

    // Deletes existing link for this file + owner
    expect(mockDb).toHaveBeenCalledWith("share_links");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith({
      file_id: "file-1",
      created_by_user_id: "user-1",
    });
    expect(mockQueryBuilder.del).toHaveBeenCalledTimes(1);

    // Inserts new link
    expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: "file-1",
        folder_id: null,
        created_by_user_id: "user-1",
      })
    );
    // Token is 64-char hex
    const insertArg = mockQueryBuilder.insert.mock.calls[0][0];
    expect(insertArg.token).toMatch(/^[0-9a-f]{64}$/);
    // expires_at is set (not null)
    expect(insertArg.expires_at).toBeTruthy();

    expect(mockQueryBuilder.returning).toHaveBeenCalledWith("*");
    expect(result).toEqual(fakeFileLink);
  });

  it("creates a folder link with correct row", async () => {
    mockQueryBuilder.del.mockResolvedValueOnce(0);
    mockQueryBuilder.returning.mockResolvedValueOnce([fakeFolderLink]);

    const result = await createShareLink("user-1", { folderId: "folder-1" }, 7200);

    expect(mockQueryBuilder.where).toHaveBeenCalledWith({
      folder_id: "folder-1",
      created_by_user_id: "user-1",
    });
    expect(mockQueryBuilder.del).toHaveBeenCalledTimes(1);

    expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: null,
        folder_id: "folder-1",
        created_by_user_id: "user-1",
      })
    );
    expect(result).toEqual(fakeFolderLink);
  });

  it("sets expires_at to null when expiresInSeconds is null", async () => {
    mockQueryBuilder.del.mockResolvedValueOnce(0);
    mockQueryBuilder.returning.mockResolvedValueOnce([
      { ...fakeFileLink, expires_at: null },
    ]);

    await createShareLink("user-1", { fileId: "file-1" }, null);

    const insertArg = mockQueryBuilder.insert.mock.calls[0][0];
    expect(insertArg.expires_at).toBeNull();
  });

  it("replaces existing active link (deletes old record before inserting)", async () => {
    mockQueryBuilder.del.mockResolvedValueOnce(1); // 1 row deleted
    mockQueryBuilder.returning.mockResolvedValueOnce([fakeFileLink]);

    await createShareLink("user-1", { fileId: "file-1" }, 3600);

    // del was called first (to remove old link)
    expect(mockQueryBuilder.del).toHaveBeenCalledTimes(1);
    // then insert
    expect(mockQueryBuilder.insert).toHaveBeenCalledTimes(1);
  });
});

/* ================================================================== */
/*  findShareLinkByToken                                               */
/* ================================================================== */

describe("findShareLinkByToken", () => {
  it("returns link for a valid, non-expired token", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(fakeFileLink);

    const result = await findShareLinkByToken(fakeFileLink.token);

    expect(mockDb).toHaveBeenCalledWith("share_links");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith({ token: fakeFileLink.token });
    expect(result).toEqual(fakeFileLink);
  });

  it("returns null for a token not in DB", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(undefined);

    const result = await findShareLinkByToken("nonexistent-token");

    expect(result).toBeNull();
  });

  it("returns null for an expired link", async () => {
    const expiredLink: IShareLink = {
      ...fakeFileLink,
      expires_at: "2020-01-01T00:00:00.000Z", // in the past
    };
    mockQueryBuilder.first.mockResolvedValueOnce(expiredLink);

    const result = await findShareLinkByToken(expiredLink.token);

    expect(result).toBeNull();
  });
});

/* ================================================================== */
/*  getShareLinkForFile                                                */
/* ================================================================== */

describe("getShareLinkForFile", () => {
  it("returns the most recent active link", async () => {
    // orderBy returns this (chainable), then first resolves
    mockQueryBuilder.first.mockResolvedValueOnce(fakeFileLink);

    const result = await getShareLinkForFile("file-1", "user-1");

    expect(mockDb).toHaveBeenCalledWith("share_links");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith({
      file_id: "file-1",
      created_by_user_id: "user-1",
    });
    expect(mockQueryBuilder.whereRaw).toHaveBeenCalledWith(
      "(expires_at IS NULL OR expires_at > NOW())"
    );
    expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith("created_at", "desc");
    expect(result).toEqual(fakeFileLink);
  });

  it("returns null if no active link exists", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(undefined);

    const result = await getShareLinkForFile("file-1", "user-1");

    expect(result).toBeNull();
  });
});

/* ================================================================== */
/*  revokeShareLink                                                    */
/* ================================================================== */

describe("revokeShareLink", () => {
  it("deletes the record for the owner", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(fakeFileLink);
    mockQueryBuilder.del.mockResolvedValueOnce(1);

    await revokeShareLink("link-1", "user-1");

    // First: looks up the link
    expect(mockQueryBuilder.where).toHaveBeenCalledWith({ id: "link-1" });
    // Then: deletes
    expect(mockQueryBuilder.del).toHaveBeenCalledTimes(1);
  });

  it("throws 'Share link not found' when ID does not exist", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(undefined);

    await expect(revokeShareLink("link-999", "user-1")).rejects.toThrow(
      "Share link not found"
    );

    expect(mockQueryBuilder.del).not.toHaveBeenCalled();
  });

  it("throws 'Access denied' when created_by_user_id does not match", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(fakeFileLink);

    await expect(revokeShareLink("link-1", "user-other")).rejects.toThrow(
      "Access denied"
    );

    expect(mockQueryBuilder.del).not.toHaveBeenCalled();
  });
});

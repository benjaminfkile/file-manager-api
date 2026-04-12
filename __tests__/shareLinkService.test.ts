/* ------------------------------------------------------------------ */
/*  Mock the database before importing the service                     */
/* ------------------------------------------------------------------ */

const mockReturning = jest.fn();
const mockInsert = jest.fn().mockReturnValue({ returning: mockReturning });
const mockDel = jest.fn();
const mockFirst = jest.fn();
const mockOrderBy = jest.fn();
const mockWhere = jest.fn().mockReturnValue({
  del: mockDel,
  first: mockFirst,
  orderBy: mockOrderBy,
});

const mockDb = jest.fn().mockReturnValue({
  insert: mockInsert,
  where: mockWhere,
});

jest.mock("../src/db/db", () => ({
  getDb: jest.fn(() => mockDb),
}));

import {
  createShareLink,
  deleteShareLink,
  getShareLinksForResource,
  getShareLinkByToken,
} from "../src/services/shareLinkService";

/* ------------------------------------------------------------------ */
/*  Reset between tests                                                */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.mockReturnValue({
    insert: mockInsert,
    where: mockWhere,
  });
  mockInsert.mockReturnValue({ returning: mockReturning });
  mockWhere.mockReturnValue({
    del: mockDel,
    first: mockFirst,
    orderBy: mockOrderBy,
  });
});

/* ================================================================== */
/*  createShareLink                                                    */
/* ================================================================== */

describe("createShareLink", () => {
  it("inserts a row and returns the created link", async () => {
    const fakeLink = {
      id: "link-1",
      token: "tok-abc",
      resource_type: "file",
      resource_id: "file-1",
      owner_user_id: "user-1",
      expires_at: null,
      created_at: "2026-04-10T00:00:00.000Z",
    };
    mockReturning.mockResolvedValue([fakeLink]);

    const result = await createShareLink("user-1", "file", "file-1", null);

    expect(mockDb).toHaveBeenCalledWith("public_share_links");
    expect(mockInsert).toHaveBeenCalledWith({
      resource_type: "file",
      resource_id: "file-1",
      owner_user_id: "user-1",
      expires_at: null,
    });
    expect(mockReturning).toHaveBeenCalledWith("*");
    expect(result).toEqual(fakeLink);
  });

  it("passes expiresAt when provided", async () => {
    const expiresAt = new Date("2026-12-31T23:59:59.000Z");
    const fakeLink = {
      id: "link-2",
      token: "tok-def",
      resource_type: "folder",
      resource_id: "folder-1",
      owner_user_id: "user-1",
      expires_at: expiresAt.toISOString(),
      created_at: "2026-04-10T00:00:00.000Z",
    };
    mockReturning.mockResolvedValue([fakeLink]);

    const result = await createShareLink("user-1", "folder", "folder-1", expiresAt);

    expect(mockInsert).toHaveBeenCalledWith({
      resource_type: "folder",
      resource_id: "folder-1",
      owner_user_id: "user-1",
      expires_at: expiresAt,
    });
    expect(result).toEqual(fakeLink);
  });
});

/* ================================================================== */
/*  deleteShareLink                                                    */
/* ================================================================== */

describe("deleteShareLink", () => {
  it("deletes the link when found", async () => {
    mockDel.mockResolvedValue(1);

    await expect(deleteShareLink("link-1", "user-1")).resolves.toBeUndefined();

    expect(mockWhere).toHaveBeenCalledWith({ id: "link-1", owner_user_id: "user-1" });
    expect(mockDel).toHaveBeenCalled();
  });

  it("throws when link not found", async () => {
    mockDel.mockResolvedValue(0);

    await expect(deleteShareLink("link-999", "user-1")).rejects.toThrow("Share link not found");
  });
});

/* ================================================================== */
/*  getShareLinksForResource                                           */
/* ================================================================== */

describe("getShareLinksForResource", () => {
  it("returns links for the given resource", async () => {
    const fakeLinks = [
      { id: "link-1", token: "tok-1", resource_type: "file", resource_id: "file-1", owner_user_id: "user-1", expires_at: null, created_at: "2026-04-10T00:00:00.000Z" },
    ];
    mockOrderBy.mockResolvedValue(fakeLinks);

    const result = await getShareLinksForResource("user-1", "file", "file-1");

    expect(mockWhere).toHaveBeenCalledWith({
      owner_user_id: "user-1",
      resource_type: "file",
      resource_id: "file-1",
    });
    expect(mockOrderBy).toHaveBeenCalledWith("created_at", "asc");
    expect(result).toEqual(fakeLinks);
  });

  it("returns empty array when no links exist", async () => {
    mockOrderBy.mockResolvedValue([]);

    const result = await getShareLinksForResource("user-1", "file", "file-1");

    expect(result).toEqual([]);
  });
});

/* ================================================================== */
/*  getShareLinkByToken                                                */
/* ================================================================== */

describe("getShareLinkByToken", () => {
  it("returns the link when found", async () => {
    const fakeLink = {
      id: "link-1",
      token: "tok-abc",
      resource_type: "file",
      resource_id: "file-1",
      owner_user_id: "user-1",
      expires_at: null,
      created_at: "2026-04-10T00:00:00.000Z",
    };
    mockFirst.mockResolvedValue(fakeLink);

    const result = await getShareLinkByToken("tok-abc");

    expect(mockWhere).toHaveBeenCalledWith({ token: "tok-abc" });
    expect(result).toEqual(fakeLink);
  });

  it("returns null when not found", async () => {
    mockFirst.mockResolvedValue(undefined);

    const result = await getShareLinkByToken("nonexistent");

    expect(result).toBeNull();
  });
});

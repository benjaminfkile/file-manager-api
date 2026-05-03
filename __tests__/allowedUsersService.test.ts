/* ------------------------------------------------------------------ */
/*  Mock the knex DB client                                            */
/* ------------------------------------------------------------------ */

const mockQueryBuilder: Record<string, jest.Mock> = {
  where: jest.fn().mockReturnThis(),
  first: jest.fn(),
  update: jest.fn(),
};

const mockDb = jest.fn((): any => mockQueryBuilder);
(mockDb as unknown as { fn: { now: () => string } }).fn = { now: () => "now()" };

jest.mock("../src/db/db", () => ({
  getDb: jest.fn(() => mockDb),
}));

import { isEmailAllowed, markEmailUsed } from "../src/services/allowedUsersService";

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryBuilder.where.mockReturnThis();
});

describe("isEmailAllowed", () => {
  it("returns true when the email is in the allow-list", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce({ email: "alice@example.com" });

    const result = await isEmailAllowed("alice@example.com");

    expect(mockDb).toHaveBeenCalledWith("allowed_users");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith("email", "alice@example.com");
    expect(result).toBe(true);
  });

  it("returns false when the email is absent", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(undefined);

    const result = await isEmailAllowed("nobody@example.com");

    expect(result).toBe(false);
  });
});

describe("markEmailUsed", () => {
  it("stamps used_at on the matching row", async () => {
    mockQueryBuilder.update.mockResolvedValueOnce(1);

    await markEmailUsed("alice@example.com");

    expect(mockQueryBuilder.where).toHaveBeenCalledWith("email", "alice@example.com");
    expect(mockQueryBuilder.update).toHaveBeenCalledWith({ used_at: "now()" });
  });
});

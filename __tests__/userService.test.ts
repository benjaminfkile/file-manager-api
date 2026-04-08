import bcrypt from "bcrypt";
import { IUser } from "../src/interfaces";

/* ------------------------------------------------------------------ */
/*  Mock the knex DB client                                           */
/* ------------------------------------------------------------------ */

const mockQueryBuilder: Record<string, jest.Mock> = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  whereRaw: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  first: jest.fn(),
};

const mockDb = jest.fn((): any => mockQueryBuilder);

jest.mock("../src/db/db", () => ({
  getDb: jest.fn(() => mockDb),
}));

jest.mock("bcrypt");

/* ------------------------------------------------------------------ */
/*  Import after mocks are in place                                   */
/* ------------------------------------------------------------------ */

import {
  createUser,
  getUserByApiKey,
  getUserById,
  searchUsersByUsername,
} from "../src/services/userService";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const fakeUser: IUser = {
  id: "uuid-1",
  first_name: "Jane",
  last_name: "Doe",
  username: "janedoe",
  api_key_hash: "$2b$10$hashedvalue",
  api_key_prefix: "ak_test_",
  created_at: "2026-04-08T00:00:00.000Z",
  updated_at: "2026-04-08T00:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  // Re-wire the chainable methods after clearAllMocks
  mockQueryBuilder.where.mockReturnThis();
  mockQueryBuilder.andWhere.mockReturnThis();
  mockQueryBuilder.select.mockReturnThis();
  mockQueryBuilder.whereRaw.mockReturnThis();
  mockQueryBuilder.insert.mockReturnThis();
});

/* ================================================================== */
/*  createUser                                                        */
/* ================================================================== */

describe("createUser", () => {
  it("happy path — inserts and returns the new user", async () => {
    // No existing user with that username
    mockQueryBuilder.first.mockResolvedValueOnce(undefined);

    (bcrypt.hash as jest.Mock).mockResolvedValueOnce("$2b$10$hashedvalue");

    const returned = {
      id: "uuid-1",
      first_name: "Jane",
      last_name: "Doe",
      username: "janedoe",
      created_at: "2026-04-08T00:00:00.000Z",
    };
    mockQueryBuilder.returning.mockResolvedValueOnce([returned]);

    const result = await createUser("Jane", "Doe", "janedoe", "ak_test_secretkey123");

    // Checked for duplicate
    expect(mockDb).toHaveBeenCalledWith("users");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith("username", "janedoe");
    expect(mockQueryBuilder.first).toHaveBeenCalled();

    // Hashed the key
    expect(bcrypt.hash).toHaveBeenCalledWith("ak_test_secretkey123", 10);

    // Inserted with correct fields
    expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
      first_name: "Jane",
      last_name: "Doe",
      username: "janedoe",
      api_key_hash: "$2b$10$hashedvalue",
      api_key_prefix: "ak_test_",
    });

    expect(result).toEqual(returned);
  });

  it("throws when the username is already taken", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(fakeUser);

    await expect(
      createUser("Jane", "Doe", "janedoe", "ak_test_secretkey123")
    ).rejects.toThrow("Username is already taken");

    // Should NOT attempt to insert
    expect(mockQueryBuilder.insert).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/*  getUserByApiKey                                                    */
/* ================================================================== */

describe("getUserByApiKey", () => {
  it("returns the user when the key matches", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(fakeUser);
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

    const result = await getUserByApiKey("ak_test_secretkey123");

    expect(mockQueryBuilder.where).toHaveBeenCalledWith("api_key_prefix", "ak_test_");
    expect(bcrypt.compare).toHaveBeenCalledWith("ak_test_secretkey123", fakeUser.api_key_hash);
    expect(result).toEqual(fakeUser);
  });

  it("returns null when no user has the prefix", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(undefined);

    const result = await getUserByApiKey("no_match_key");

    expect(result).toBeNull();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it("returns null when the prefix matches but bcrypt compare fails", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(fakeUser);
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

    const result = await getUserByApiKey("ak_test_wrongkey999");

    expect(result).toBeNull();
  });
});

/* ================================================================== */
/*  getUserById                                                       */
/* ================================================================== */

describe("getUserById", () => {
  it("returns the user when found", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(fakeUser);

    const result = await getUserById("uuid-1");

    expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", "uuid-1");
    expect(result).toEqual(fakeUser);
  });

  it("returns null when not found", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(undefined);

    const result = await getUserById("uuid-missing");

    expect(result).toBeNull();
  });
});

/* ================================================================== */
/*  searchUsersByUsername                                              */
/* ================================================================== */

describe("searchUsersByUsername", () => {
  it("returns matching users", async () => {
    const matches = [
      { id: "uuid-1", username: "janedoe", first_name: "Jane", last_name: "Doe" },
      { id: "uuid-2", username: "johndoe", first_name: "John", last_name: "Doe" },
    ];

    // The query builder itself is the thenable — resolve it
    mockQueryBuilder.whereRaw.mockReturnThis();
    // searchUsersByUsername returns the query builder directly (no .first()),
    // so we need the builder to resolve as a promise to the matches array.
    // Override the mockDb call for this test so the returned builder is thenable.
    const searchBuilder = {
      select: jest.fn().mockReturnThis(),
      whereRaw: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve(matches),
    };
    mockDb.mockReturnValueOnce(searchBuilder);

    const result = await searchUsersByUsername("doe", "uuid-3");

    expect(searchBuilder.select).toHaveBeenCalledWith(
      "id", "username", "first_name", "last_name"
    );
    expect(searchBuilder.whereRaw).toHaveBeenCalledWith(
      "username ILIKE ?",
      ["%doe%"]
    );
    expect(searchBuilder.andWhere).toHaveBeenCalledWith("id", "!=", "uuid-3");
    expect(result).toEqual(matches);
  });

  it("omits the excludeUserId filter when not provided", async () => {
    const searchBuilder = {
      select: jest.fn().mockReturnThis(),
      whereRaw: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve([]),
    };
    mockDb.mockReturnValueOnce(searchBuilder);

    const result = await searchUsersByUsername("test");

    expect(searchBuilder.andWhere).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

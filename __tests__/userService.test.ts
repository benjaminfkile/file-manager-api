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

/* ------------------------------------------------------------------ */
/*  Import after mocks are in place                                   */
/* ------------------------------------------------------------------ */

import {
  createUser,
  getUserByCognitoSub,
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
  cognito_sub: "cognito-sub-janedoe",
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

    const returned = {
      id: "uuid-1",
      first_name: "Jane",
      last_name: "Doe",
      username: "janedoe",
      created_at: "2026-04-08T00:00:00.000Z",
    };
    mockQueryBuilder.returning.mockResolvedValueOnce([returned]);

    const result = await createUser("Jane", "Doe", "janedoe", "cognito-sub-janedoe");

    // Checked for duplicate
    expect(mockDb).toHaveBeenCalledWith("users");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith("username", "janedoe");
    expect(mockQueryBuilder.first).toHaveBeenCalled();

    // Inserted with correct fields
    expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
      first_name: "Jane",
      last_name: "Doe",
      username: "janedoe",
      cognito_sub: "cognito-sub-janedoe",
    });

    expect(result).toEqual(returned);
  });

  it("throws when the username is already taken", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(fakeUser);

    await expect(
      createUser("Jane", "Doe", "janedoe", "cognito-sub-janedoe")
    ).rejects.toThrow("Username is already taken");

    // Should NOT attempt to insert
    expect(mockQueryBuilder.insert).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/*  getUserByCognitoSub                                               */
/* ================================================================== */

describe("getUserByCognitoSub", () => {
  it("returns the user when the cognito sub matches", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(fakeUser);

    const result = await getUserByCognitoSub("cognito-sub-janedoe");

    expect(mockQueryBuilder.where).toHaveBeenCalledWith("cognito_sub", "cognito-sub-janedoe");
    expect(result).toEqual(fakeUser);
  });

  it("returns null when no user has the cognito sub", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(undefined);

    const result = await getUserByCognitoSub("cognito-sub-unknown");

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

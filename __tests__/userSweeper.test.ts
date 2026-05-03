/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockFindExpiredUsers = jest.fn();
const mockFindUsersNotInAllowList = jest.fn();
const mockDeleteUserCompletely = jest.fn();
jest.mock("../src/services/userService", () => ({
  findExpiredUsers: mockFindExpiredUsers,
  findUsersNotInAllowList: mockFindUsersNotInAllowList,
  deleteUserCompletely: mockDeleteUserCompletely,
}));

const mockListAllCognitoUsers = jest.fn();
const mockDeleteCognitoUserBySub = jest.fn();
jest.mock("../src/aws/cognitoAdmin", () => ({
  listAllCognitoUsers: mockListAllCognitoUsers,
  deleteCognitoUserBySub: mockDeleteCognitoUserBySub,
}));

const mockWhereIn = jest.fn();
const mockSelect = jest.fn();
const mockTableBuilder = {
  whereIn: jest.fn(() => ({ select: mockSelect })),
};
const mockDb = jest.fn(() => mockTableBuilder);
jest.mock("../src/db/db", () => ({
  getDb: jest.fn(() => mockDb),
}));

/* ------------------------------------------------------------------ */
/*  Imports after mocks                                                */
/* ------------------------------------------------------------------ */

import {
  sweepExpiredUsers,
  sweepOrphanCognitoUsers,
  sweepDisallowedUsers,
  startUserSweeper,
  stopUserSweeper,
} from "../src/services/userSweeper";

beforeEach(() => {
  jest.clearAllMocks();
  mockTableBuilder.whereIn.mockImplementation(() => ({ select: mockSelect }));
  // Default: dev mode (production sweep gated off). Each prod test re-arms
  // it explicitly via startUserSweeper(true).
  startUserSweeper.length; // no-op reference; the production flag lives in
                            // module scope and is reset by stopUserSweeper +
                            // re-call below in tests that need it.
});

afterEach(() => {
  stopUserSweeper();
  delete process.env.DISABLE_USER_SWEEPER;
  // Reset prod flag back to false for the next test by re-initialising in
  // dev mode without starting the timer.
  process.env.DISABLE_USER_SWEEPER = "true";
  startUserSweeper(false);
  delete process.env.DISABLE_USER_SWEEPER;
});

describe("sweepExpiredUsers", () => {
  it("calls deleteUserCompletely for each expired user", async () => {
    const expired = [
      { id: "u1", cognito_sub: "sub1" },
      { id: "u2", cognito_sub: "sub2" },
    ];
    mockFindExpiredUsers.mockResolvedValue(expired);
    mockDeleteUserCompletely.mockResolvedValue(undefined);

    const count = await sweepExpiredUsers();

    expect(count).toBe(2);
    expect(mockDeleteUserCompletely).toHaveBeenCalledTimes(2);
    expect(mockDeleteUserCompletely).toHaveBeenNthCalledWith(1, expired[0]);
    expect(mockDeleteUserCompletely).toHaveBeenNthCalledWith(2, expired[1]);
  });

  it("returns 0 and does nothing when no users have expired", async () => {
    mockFindExpiredUsers.mockResolvedValue([]);

    const count = await sweepExpiredUsers();

    expect(count).toBe(0);
    expect(mockDeleteUserCompletely).not.toHaveBeenCalled();
  });

  it("logs but continues when one user's deletion fails", async () => {
    const expired = [
      { id: "u1", cognito_sub: "sub1" },
      { id: "u2", cognito_sub: "sub2" },
    ];
    mockFindExpiredUsers.mockResolvedValue(expired);
    mockDeleteUserCompletely
      .mockRejectedValueOnce(new Error("S3 down"))
      .mockResolvedValueOnce(undefined);

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const count = await sweepExpiredUsers();

    expect(count).toBe(2);
    expect(mockDeleteUserCompletely).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe("sweepOrphanCognitoUsers", () => {
  const oldEnough = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
  const tooNew = new Date(Date.now() - 60 * 1000); // 1 min ago

  it("deletes Cognito users with no matching local row that are past the grace period", async () => {
    mockListAllCognitoUsers.mockResolvedValue([
      { username: "alice@x.com", sub: "sub-alice", email: "alice@x.com", createdAt: oldEnough },
      { username: "bob@x.com", sub: "sub-bob", email: "bob@x.com", createdAt: oldEnough },
    ]);
    // Only alice has a matching local row
    mockSelect.mockResolvedValue([{ cognito_sub: "sub-alice" }]);
    mockDeleteCognitoUserBySub.mockResolvedValue(true);

    const deleted = await sweepOrphanCognitoUsers();

    expect(deleted).toBe(1);
    expect(mockDeleteCognitoUserBySub).toHaveBeenCalledTimes(1);
    expect(mockDeleteCognitoUserBySub).toHaveBeenCalledWith("sub-bob");
  });

  it("skips Cognito users that are within the orphan grace period", async () => {
    mockListAllCognitoUsers.mockResolvedValue([
      { username: "fresh@x.com", sub: "sub-fresh", email: "fresh@x.com", createdAt: tooNew },
    ]);
    mockSelect.mockResolvedValue([]);

    const deleted = await sweepOrphanCognitoUsers();

    expect(deleted).toBe(0);
    expect(mockDeleteCognitoUserBySub).not.toHaveBeenCalled();
  });

  it("returns 0 when there are no Cognito users at all", async () => {
    mockListAllCognitoUsers.mockResolvedValue([]);

    const deleted = await sweepOrphanCognitoUsers();

    expect(deleted).toBe(0);
    expect(mockDeleteCognitoUserBySub).not.toHaveBeenCalled();
  });

  it("logs and continues if AdminDeleteUser throws for one orphan", async () => {
    mockListAllCognitoUsers.mockResolvedValue([
      { username: "a@x.com", sub: "sub-a", email: "a@x.com", createdAt: oldEnough },
      { username: "b@x.com", sub: "sub-b", email: "b@x.com", createdAt: oldEnough },
    ]);
    mockSelect.mockResolvedValue([]);
    mockDeleteCognitoUserBySub
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce(true);

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const deleted = await sweepOrphanCognitoUsers();

    expect(deleted).toBe(1);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("returns 0 if listAllCognitoUsers throws", async () => {
    mockListAllCognitoUsers.mockRejectedValue(new Error("Cognito unreachable"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const deleted = await sweepOrphanCognitoUsers();

    expect(deleted).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("sweepDisallowedUsers", () => {
  it("is a no-op outside production", async () => {
    process.env.DISABLE_USER_SWEEPER = "true";
    startUserSweeper(false); // arm dev mode without starting the timer
    delete process.env.DISABLE_USER_SWEEPER;

    mockFindUsersNotInAllowList.mockResolvedValue([
      { id: "u1", cognito_sub: "sub1", email: "a@x.com" },
    ]);

    const count = await sweepDisallowedUsers();

    expect(count).toBe(0);
    expect(mockFindUsersNotInAllowList).not.toHaveBeenCalled();
    expect(mockDeleteUserCompletely).not.toHaveBeenCalled();
  });

  it("deletes every user not on the allow-list when in production", async () => {
    process.env.DISABLE_USER_SWEEPER = "true";
    startUserSweeper(true);
    delete process.env.DISABLE_USER_SWEEPER;

    const disallowed = [
      { id: "u1", cognito_sub: "sub1", email: "a@x.com" },
      { id: "u2", cognito_sub: "sub2", email: "b@x.com" },
    ];
    mockFindUsersNotInAllowList.mockResolvedValue(disallowed);
    mockDeleteUserCompletely.mockResolvedValue(undefined);

    const count = await sweepDisallowedUsers();

    expect(count).toBe(2);
    expect(mockDeleteUserCompletely).toHaveBeenCalledTimes(2);
    expect(mockDeleteUserCompletely).toHaveBeenNthCalledWith(1, disallowed[0]);
    expect(mockDeleteUserCompletely).toHaveBeenNthCalledWith(2, disallowed[1]);
  });

  it("logs but continues when one disallowed user's deletion fails", async () => {
    process.env.DISABLE_USER_SWEEPER = "true";
    startUserSweeper(true);
    delete process.env.DISABLE_USER_SWEEPER;

    mockFindUsersNotInAllowList.mockResolvedValue([
      { id: "u1", cognito_sub: "sub1", email: "a@x.com" },
      { id: "u2", cognito_sub: "sub2", email: "b@x.com" },
    ]);
    mockDeleteUserCompletely
      .mockRejectedValueOnce(new Error("S3 down"))
      .mockResolvedValueOnce(undefined);

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const count = await sweepDisallowedUsers();

    expect(count).toBe(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("startUserSweeper toggle", () => {
  it("does not register an interval when DISABLE_USER_SWEEPER=true", () => {
    process.env.DISABLE_USER_SWEEPER = "true";
    const setSpy = jest.spyOn(global, "setInterval");

    startUserSweeper();

    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it("registers a 60-second interval when not disabled", () => {
    mockFindExpiredUsers.mockResolvedValue([]);
    mockFindUsersNotInAllowList.mockResolvedValue([]);
    mockListAllCognitoUsers.mockResolvedValue([]);
    const setSpy = jest.spyOn(global, "setInterval");

    startUserSweeper();

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][1]).toBe(60 * 1000);

    setSpy.mockRestore();
  });
});

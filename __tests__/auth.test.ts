import request from "supertest";
import express from "express";
import { IUser } from "../src/interfaces";

/* ------------------------------------------------------------------ */
/*  Mocks                                                             */
/* ------------------------------------------------------------------ */

const mockVerifyCognitoToken = jest.fn();
jest.mock("../src/aws/cognitoAuth", () => ({
  verifyCognitoToken: mockVerifyCognitoToken,
}));

const mockGetUserByCognitoSub = jest.fn();
jest.mock("../src/services/userService", () => ({
  getUserByCognitoSub: mockGetUserByCognitoSub,
}));

import protectedRoute from "../src/middleware/protectedRoute";

/* ------------------------------------------------------------------ */
/*  Fake data                                                         */
/* ------------------------------------------------------------------ */

const userA: IUser = {
  id: "aaaa-aaaa-aaaa-aaaa",
  first_name: "Alice",
  last_name: "Anderson",
  username: "alice",
  cognito_sub: "cognito-sub-aaaa",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const userB: IUser = {
  id: "bbbb-bbbb-bbbb-bbbb",
  first_name: "Bob",
  last_name: "Baker",
  username: "bob",
  cognito_sub: "cognito-sub-bbbb",
  created_at: "2026-01-02T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

// Minimal express app with a protected route for testing the middleware
const app = express();
app.use(express.json());
app.get("/protected", protectedRoute(), (req, res) => {
  const user = req.user as IUser;
  res.status(200).json({ user });
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("protectedRoute auth middleware", () => {
  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).get("/protected");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when Authorization header is not Bearer", async () => {
    const res = await request(app)
      .get("/protected")
      .set("authorization", "Basic sometoken");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCognitoToken.mockRejectedValueOnce(new Error("Invalid token"));

    const res = await request(app)
      .get("/protected")
      .set("authorization", "Bearer bad.token.here");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when token is valid but no matching user is found", async () => {
    mockVerifyCognitoToken.mockResolvedValueOnce({ sub: "cognito-sub-unknown" });
    mockGetUserByCognitoSub.mockResolvedValueOnce(null);

    const res = await request(app)
      .get("/protected")
      .set("authorization", "Bearer valid.token.here");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("returns 200 and populates req.user with a valid token", async () => {
    mockVerifyCognitoToken.mockResolvedValueOnce({ sub: userA.cognito_sub });
    mockGetUserByCognitoSub.mockResolvedValueOnce({ ...userA });

    const res = await request(app)
      .get("/protected")
      .set("authorization", "Bearer valid.token.for.alice");

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: userA.id,
      first_name: userA.first_name,
      last_name: userA.last_name,
      username: userA.username,
    });
  });

  it("authenticates two different users with different tokens correctly", async () => {
    // User A authenticates
    mockVerifyCognitoToken.mockResolvedValueOnce({ sub: userA.cognito_sub });
    mockGetUserByCognitoSub.mockResolvedValueOnce({ ...userA });

    const resA = await request(app)
      .get("/protected")
      .set("authorization", "Bearer token.for.alice");

    expect(resA.status).toBe(200);
    expect(resA.body.user.username).toBe("alice");
    expect(resA.body.user.id).toBe(userA.id);

    // User B authenticates
    mockVerifyCognitoToken.mockResolvedValueOnce({ sub: userB.cognito_sub });
    mockGetUserByCognitoSub.mockResolvedValueOnce({ ...userB });

    const resB = await request(app)
      .get("/protected")
      .set("authorization", "Bearer token.for.bob");

    expect(resB.status).toBe(200);
    expect(resB.body.user.username).toBe("bob");
    expect(resB.body.user.id).toBe(userB.id);
  });
});

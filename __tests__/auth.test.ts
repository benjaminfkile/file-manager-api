import request from "supertest";
import express from "express";
import bcrypt from "bcrypt";
import { IUser } from "../src/interfaces";

const mockFirst = jest.fn();
const mockWhere = jest.fn().mockReturnValue({ first: mockFirst });
const mockDbQueryBuilder = jest.fn().mockReturnValue({ where: mockWhere });

jest.mock("../src/db/db", () => ({
  getDb: jest.fn().mockReturnValue(mockDbQueryBuilder),
}));

import protectedRoute from "../src/middleware/protectedRoute";

const RAW_KEY_A = "AAAAAAAA_secret_key_for_user_a";
const RAW_KEY_B = "BBBBBBBB_secret_key_for_user_b";

const userA: IUser = {
  id: "aaaa-aaaa-aaaa-aaaa",
  first_name: "Alice",
  last_name: "Anderson",
  username: "alice",
  api_key_prefix: RAW_KEY_A.slice(0, 8),
  api_key_hash: "",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const userB: IUser = {
  id: "bbbb-bbbb-bbbb-bbbb",
  first_name: "Bob",
  last_name: "Baker",
  username: "bob",
  api_key_prefix: RAW_KEY_B.slice(0, 8),
  api_key_hash: "",
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

beforeAll(async () => {
  userA.api_key_hash = await bcrypt.hash(RAW_KEY_A, 10);
  userB.api_key_hash = await bcrypt.hash(RAW_KEY_B, 10);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDbQueryBuilder.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ first: mockFirst });
  mockFirst.mockResolvedValue(undefined);
});

describe("protectedRoute auth middleware", () => {
  it("returns 401 when no x-api-key header is provided", async () => {
    const res = await request(app).get("/protected");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when an invalid key is provided", async () => {
    mockFirst.mockResolvedValue(undefined);

    const res = await request(app)
      .get("/protected")
      .set("x-api-key", "INVALIDX_not_a_real_key");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("returns 200 and populates req.user with a valid key", async () => {
    mockFirst.mockResolvedValue({ ...userA });

    const res = await request(app)
      .get("/protected")
      .set("x-api-key", RAW_KEY_A);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: userA.id,
      first_name: userA.first_name,
      last_name: userA.last_name,
      username: userA.username,
    });
  });

  it("authenticates two different users with different keys correctly", async () => {
    // User A authenticates
    mockFirst.mockResolvedValue({ ...userA });

    const resA = await request(app)
      .get("/protected")
      .set("x-api-key", RAW_KEY_A);

    expect(resA.status).toBe(200);
    expect(resA.body.user.username).toBe("alice");
    expect(resA.body.user.id).toBe(userA.id);

    // User B authenticates
    mockFirst.mockResolvedValue({ ...userB });

    const resB = await request(app)
      .get("/protected")
      .set("x-api-key", RAW_KEY_B);

    expect(resB.status).toBe(200);
    expect(resB.body.user.username).toBe("bob");
    expect(resB.body.user.id).toBe(userB.id);
  });
});

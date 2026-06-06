import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../app";

beforeAll(() => {
  process.env.JWT_SECRET ??= "01234567890123456789012345678901";
});

describe("api JWT guard", () => {
  test("returns 401 without Authorization on protected /api route", async () => {
    const app = createApp();
    const res = await app.request("http://localhost/api/clouds", {
      method: "GET",
    });
    expect(res.status).toBe(401);
  });

  test("returns 401 for malformed bearer token on protected route", async () => {
    const app = createApp();
    const res = await app.request("http://localhost/api/clouds", {
      method: "GET",
      headers: { Authorization: "Bearer not-a-jwt" },
    });
    expect(res.status).toBe(401);
  });
});

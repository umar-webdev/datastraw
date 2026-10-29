import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app";

const dist = path.resolve(import.meta.dir, "../../client/dist");

describe.skipIf(!existsSync(dist))("serving the built React app", () => {
  const app = createApp();

  test("deep links get the app shell so React Router can handle them", async () => {
    const res = await request(app).get("/agent/conversations/123");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
  });

  test("built assets are served with their real type", async () => {
    const js = readdirSync(path.join(dist, "assets")).find((f) => f.endsWith(".js"))!;
    const res = await request(app).get(`/assets/${js}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
  });

  test("a missing asset is a 404, not the app shell", async () => {
    expect((await request(app).get("/assets/old-bundle.js")).status).toBe(404);
    expect((await request(app).get("/api/nope")).status).toBe(404);
  });
});

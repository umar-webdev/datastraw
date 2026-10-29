import { beforeEach, describe, expect, test } from "bun:test";
import request from "supertest";
import { createApp } from "../src/app";
import { pool } from "../src/db/pool";
import { hasTestDb, makeEvent, resetDb, settleDrafts, signed, waitForDrafts } from "./helpers";

const app = createApp();

function postWebhook(body: unknown, signature?: string) {
  const s = signed(body);
  return request(app)
    .post("/webhook")
    .set("Content-Type", "application/json")
    .set("X-Signature", signature ?? s.signature)
    .send(s.raw);
}

async function count(table: string): Promise<number> {
  return Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
}

describe("POST /webhook: rejected before touching the database", () => {
  test("401 without a valid signature", async () => {
    const res = await postWebhook(makeEvent(), "sha256=" + "0".repeat(64));
    expect(res.status).toBe(401);
    const missing = await request(app).post("/webhook").set("Content-Type", "application/json").send("{}");
    expect(missing.status).toBe(401);
  });

  test("400 when signed but not JSON", async () => {
    const raw = "not json";
    const { signBody } = await import("../src/lib/signature");
    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("X-Signature", signBody(raw, process.env.WEBHOOK_SECRET!))
      .send(raw);
    expect(res.status).toBe(400);
  });

  test("400 with field errors when the payload shape is wrong", async () => {
    const event = makeEvent() as Record<string, unknown>;
    delete event.customer;
    const res = await postWebhook(event);
    expect(res.status).toBe(400);
    expect(res.body.issues[0].path).toEqual(["customer"]);
  });

  test("400 when the text is empty", async () => {
    const res = await postWebhook(makeEvent({ text: "   " }));
    expect(res.status).toBe(400);
  });

  test("422 for another brand", async () => {
    const res = await postWebhook({ ...makeEvent(), brand_id: "other-brand" });
    expect(res.status).toBe(422);
  });

  test("200 ignored for non-text messages and other event types", async () => {
    const image = makeEvent();
    const imageRes = await postWebhook({ ...image, message: { id: "m1", type: "image" } });
    expect(imageRes.status).toBe(200);
    expect(imageRes.body.status).toBe("ignored");

    const other = await postWebhook({ ...makeEvent(), type: "message.read" });
    expect(other.body.status).toBe("ignored");
  });
});

describe.skipIf(!hasTestDb)("POST /webhook: storing messages", () => {
  // Let the previous test's background drafting finish before wiping the tables.
  // (Done here rather than in afterEach: on Bun 1.1, awaiting DB work in afterEach never resumes.)
  beforeEach(async () => {
    await settleDrafts();
    await resetDb();
  });

  test("saves customer, conversation, message and a draft that is then generated", async () => {
    const res = await postWebhook(makeEvent({ text: "Hi, my order #4471 hasn't arrived yet." }));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");

    const conv = await pool.query("SELECT * FROM conversations WHERE id = $1", [res.body.conversationId]);
    expect(conv.rows[0].status).toBe("open");
    expect(conv.rows[0].last_message_preview).toBe("Hi, my order #4471 hasn't arrived yet.");

    await waitForDrafts();
    const draft = await pool.query("SELECT * FROM drafts WHERE id = $1", [res.body.draftId]);
    expect(draft.rows[0].status).toBe("ready");
    expect(draft.rows[0].text).toBe("Fake draft.");
    expect(draft.rows[0].message_id).toBe(res.body.messageId);
  });

  test("a replayed event_id is stored once", async () => {
    const event = makeEvent();
    const first = await postWebhook(event);
    const second = await postWebhook(event);
    expect(first.body.status).toBe("accepted");
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("duplicate");
    expect(await count("messages")).toBe(1);
    expect(await count("drafts")).toBe(1);
  });

  test("a known message id under a new event_id is stored once", async () => {
    await postWebhook(makeEvent({ messageId: "msg_same" }));
    const again = await postWebhook(makeEvent({ messageId: "msg_same" }));
    expect(again.body.status).toBe("duplicate");
    expect(await count("messages")).toBe(1);
  });

  test("a second message joins the open conversation and supersedes the old draft", async () => {
    const first = await postWebhook(makeEvent({ text: "First" }));
    const second = await postWebhook(makeEvent({ text: "Second" }));
    expect(second.body.conversationId).toBe(first.body.conversationId);
    expect(await count("conversations")).toBe(1);

    await waitForDrafts();
    const drafts = await pool.query("SELECT id, status FROM drafts ORDER BY created_at");
    expect(drafts.rows.map((d) => d.status)).toEqual(["superseded", "ready"]);
  });

  test("different customers get different conversations", async () => {
    await postWebhook(makeEvent({ customerId: "cust_a" }));
    await postWebhook(makeEvent({ customerId: "cust_b" }));
    expect(await count("conversations")).toBe(2);
  });

  test("simultaneous messages from one customer still share one conversation", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => postWebhook(makeEvent({ text: `m${i}` }))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await count("conversations")).toBe(1);
    expect(await count("messages")).toBe(5);
    const live = await pool.query("SELECT count(*) FROM drafts WHERE status IN ('pending', 'ready', 'failed')");
    expect(Number(live.rows[0].count)).toBe(1);
  });

  test("an older message delivered late doesn't replace the latest preview", async () => {
    await postWebhook(makeEvent({ text: "Newest" }));
    const late = { ...makeEvent({ text: "Older" }), timestamp: "2020-01-01T00:00:00Z" };
    await postWebhook(late);
    const conv = await pool.query("SELECT last_message_preview FROM conversations");
    expect(conv.rows[0].last_message_preview).toBe("Newest");
  });
});

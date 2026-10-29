import { beforeEach, describe, expect, test } from "bun:test";
import request from "supertest";
import { createApp } from "../src/app";
import { pool } from "../src/db/pool";
import { hasTestDb, makeEvent, resetDb, signed } from "./helpers";

const app = createApp();
const aisha = { id: "cust_1042", name: "Aisha Khan", phone: "+919800000001" };

describe.skipIf(!hasTestDb)("Customer view endpoints", () => {
  beforeEach(resetDb);

  test("a Customer view message is stored exactly like a webhook message", async () => {
    const res = await request(app).post("/api/customer/messages").send({ customer: aisha, text: "Return policy?" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("accepted");

    // A webhook message from the same customer lands in the same conversation.
    const s = signed(makeEvent({ customerId: aisha.id }));
    const hook = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("X-Signature", s.signature)
      .send(s.raw);
    expect(hook.body.conversationId).toBe(res.body.conversationId);

    const events = await pool.query("SELECT source FROM webhook_events ORDER BY received_at");
    expect(events.rows.map((e) => e.source)).toEqual(["customer_view", "webhook"]);
  });

  test("a typed-in customer gets a stable id from their phone", async () => {
    const customer = { name: "New Person", phone: "+91 98000 11111" };
    const a = await request(app).post("/api/customer/messages").send({ customer, text: "one" });
    const b = await request(app).post("/api/customer/messages").send({ customer, text: "two" });
    expect(a.body.customerId).toBe("web_919800011111");
    expect(b.body.conversationId).toBe(a.body.conversationId);
  });

  test("validates input", async () => {
    const empty = await request(app).post("/api/customer/messages").send({ customer: aisha, text: "  " });
    expect(empty.status).toBe(400);
    const badPhone = await request(app)
      .post("/api/customer/messages")
      .send({ customer: { name: "X", phone: "call me" }, text: "hi" });
    expect(badPhone.status).toBe(400);
  });

  test("the conversation shows messages and approved replies, never drafts", async () => {
    const sent = await request(app).post("/api/customer/messages").send({ customer: aisha, text: "Hello" });
    await pool.query("UPDATE drafts SET status = 'ready', text = 'SECRET DRAFT TEXT' WHERE id = $1", [sent.body.draftId]);

    const res = await request(app).get("/api/customer/conversation").query({ customerId: aisha.id });
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]).toMatchObject({ sender: "customer", text: "Hello" });
    expect(JSON.stringify(res.body)).not.toContain("SECRET DRAFT TEXT");
  });

  test("an unknown customer has an empty conversation", async () => {
    const res = await request(app).get("/api/customer/conversation").query({ customerId: "nobody" });
    expect(res.body).toEqual({ conversationId: null, messages: [] });
  });

  test("lists the test customers", async () => {
    const res = await request(app).get("/api/customer/test-customers");
    expect(res.body.customers[0]).toEqual(aisha);
  });
});

describe("Customer view rate limit", () => {
  test("returns 429 after 30 sends a minute from one IP", async () => {
    const limited = createApp(); // fresh limiter state
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      statuses.push((await request(limited).post("/api/customer/messages").send({})).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true); // reaches validation
    expect(statuses[30]).toBe(429);
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import request from "supertest";
import { createApp } from "../src/app";
import { pool } from "../src/db/pool";
import { seedAgent } from "../src/db/seed";
import { hasTestDb, llmReply, makeEvent, resetDb, setFakeLlm, settleDrafts, signed, waitForDrafts } from "./helpers";

const app = createApp();
const AGENT = { email: "agent@verdant.test", password: "test-password" }; // from preload.ts

async function signIn(): Promise<string> {
  const res = await request(app).post("/api/auth/login").send(AGENT);
  expect(res.status).toBe(200);
  return res.headers["set-cookie"]![0]!.split(";")[0]!;
}

async function sendWebhook(overrides: Parameters<typeof makeEvent>[0] = {}) {
  const s = signed(makeEvent(overrides));
  const res = await request(app)
    .post("/webhook")
    .set("Content-Type", "application/json")
    .set("X-Signature", s.signature)
    .send(s.raw);
  return res.body as { conversationId: string; draftId: string };
}

describe("agent routes need a session", () => {
  test("401 without a cookie or with a forged one", async () => {
    expect((await request(app).get("/api/agent/conversations")).status).toBe(401);
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    const forged = await request(app).get("/api/agent/conversations").set("Cookie", "verdant_session=eyJhbGciOiJIUzI1NiJ9.e30.x");
    expect(forged.status).toBe(401);
  });
});

describe.skipIf(!hasTestDb)("sign in", () => {
  beforeEach(async () => {
    await settleDrafts();
    await resetDb();
    await seedAgent();
  });

  test("wrong password or unknown email is rejected with the same message", async () => {
    const wrong = await request(app).post("/api/auth/login").send({ ...AGENT, password: "nope" });
    const unknown = await request(app).post("/api/auth/login").send({ email: "who@verdant.test", password: "x" });
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.headers["set-cookie"]).toBeUndefined();
  });

  test("sets an httpOnly cookie that works until logout", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "  AGENT@verdant.test ", password: AGENT.password });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"]![0]!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    const cookie = setCookie.split(";")[0]!;

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.body.agent.email).toBe("agent@verdant.test");

    const out = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(out.status).toBe(204);
    expect(out.headers["set-cookie"]![0]).toContain("verdant_session=;");
  });

  test("failed logins are rate limited", async () => {
    const limited = createApp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await request(limited).post("/api/auth/login").send({ ...AGENT, password: "nope" })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe.skipIf(!hasTestDb)("agent inbox", () => {
  let cookie: string;
  beforeEach(async () => {
    setFakeLlm();
    await settleDrafts();
    await resetDb();
    await seedAgent();
    cookie = await signIn();
  });

  const get = (path: string) => request(app).get(path).set("Cookie", cookie);
  const post = (path: string, body: object = {}) => request(app).post(path).set("Cookie", cookie).send(body);

  test("lists conversations with the newest activity first", async () => {
    await sendWebhook({ customerId: "cust_a", text: "Older question" });
    await sendWebhook({ customerId: "cust_b", text: "Newer question" });
    await waitForDrafts();

    const res = await get("/api/agent/conversations");
    expect(res.status).toBe(200);
    expect(res.body.conversations.map((c: any) => c.preview)).toEqual(["Newer question", "Older question"]);
    expect(res.body.conversations[0]).toMatchObject({ customerName: "Aisha Khan", draftStatus: "ready", lastSender: "customer" });
  });

  test("shows a conversation's messages in order with its live draft", async () => {
    const { conversationId } = await sendWebhook({ text: "First" });
    await sendWebhook({ text: "Second" });
    await waitForDrafts();

    const res = await get(`/api/agent/conversations/${conversationId}`);
    expect(res.body.messages.map((m: any) => m.text)).toEqual(["First", "Second"]);
    expect(res.body.draft).toMatchObject({ status: "ready", text: "Fake draft." });
    expect((await get("/api/agent/conversations/00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await get("/api/agent/conversations/not-a-uuid")).status).toBe(400);
  });

  test("approving saves the edited text as a reply the customer can see", async () => {
    const { conversationId, draftId } = await sendWebhook({ text: "What is your return policy?" });
    await waitForDrafts();

    const res = await post(`/api/agent/drafts/${draftId}/approve`, { text: "  Edited by the agent.  " });
    expect(res.status).toBe(201);
    expect(res.body.message).toMatchObject({ sender: "agent", text: "Edited by the agent." });

    const draft = (await pool.query("SELECT status, approved_message_id FROM drafts WHERE id = $1", [draftId])).rows[0];
    expect(draft.status).toBe("approved");
    expect(draft.approved_message_id).toBe(res.body.message.id);

    const detail = await get(`/api/agent/conversations/${conversationId}`);
    expect(detail.body.draft).toBeNull();
    expect(detail.body.messages.at(-1)).toMatchObject({ sender: "agent", agentName: "Support Agent" });

    const list = await get("/api/agent/conversations");
    expect(list.body.conversations[0]).toMatchObject({ lastSender: "agent", draftStatus: null });

    const customer = await request(app).get("/api/customer/conversation").query({ customerId: "cust_1042" });
    expect(customer.body.messages.map((m: any) => m.text)).toEqual(["What is your return policy?", "Edited by the agent."]);
  });

  test("a draft can only be approved once, even with simultaneous clicks", async () => {
    const { draftId } = await sendWebhook();
    await waitForDrafts();
    const results = await Promise.all([1, 2, 3].map(() => post(`/api/agent/drafts/${draftId}/approve`, { text: "Hi" })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const replies = await pool.query("SELECT count(*)::int AS n FROM messages WHERE sender = 'agent'");
    expect(replies.rows[0].n).toBe(1);
  });

  test("a draft replaced by a newer customer message can't be approved", async () => {
    const first = await sendWebhook({ text: "First" });
    await sendWebhook({ text: "Second" });
    await waitForDrafts();
    const res = await post(`/api/agent/drafts/${first.draftId}/approve`, { text: "Answer to first" });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("new message");
  });

  test("rejects an empty reply and an unknown draft", async () => {
    const { draftId } = await sendWebhook();
    await waitForDrafts();
    expect((await post(`/api/agent/drafts/${draftId}/approve`, { text: "   " })).status).toBe(400);
    expect((await post("/api/agent/drafts/00000000-0000-0000-0000-000000000000/approve", { text: "Hi" })).status).toBe(404);
  });

  test("an agent can reply even when the AI draft failed", async () => {
    setFakeLlm(() => new Response("bad key", { status: 401 }));
    const { draftId } = await sendWebhook();
    await waitForDrafts();
    expect((await pool.query("SELECT status FROM drafts WHERE id = $1", [draftId])).rows[0].status).toBe("failed");

    const res = await post(`/api/agent/drafts/${draftId}/approve`, { text: "Written by hand." });
    expect(res.status).toBe(201);
  });

  test("regenerate replaces a failed draft with a fresh one", async () => {
    setFakeLlm(() => new Response("bad key", { status: 401 }));
    const { draftId } = await sendWebhook();
    await waitForDrafts();

    setFakeLlm(() => llmReply('{"reply":"Second try","needs_attention":false,"reason":""}'));
    const res = await post(`/api/agent/drafts/${draftId}/regenerate`);
    expect(res.status).toBe(202);
    await waitForDrafts();
    const draft = (await pool.query("SELECT status, text, attempts FROM drafts WHERE id = $1", [draftId])).rows[0];
    expect(draft).toMatchObject({ status: "ready", text: "Second try", attempts: 1 });

    const approved = await post(`/api/agent/drafts/${draftId}/approve`, { text: "Second try" });
    expect(approved.status).toBe(201);
    expect((await post(`/api/agent/drafts/${draftId}/regenerate`)).status).toBe(409);
  });
});

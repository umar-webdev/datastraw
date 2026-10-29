import { pool } from "../src/db/pool";
import { runMigrations } from "../src/db/migrate";
import { signBody } from "../src/lib/signature";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

export async function resetDb(): Promise<void> {
  await runMigrations();
  await pool.query("TRUNCATE drafts, messages, conversations, customers, webhook_events, agents CASCADE");
}

let counter = 0;

/** A valid webhook payload; pass overrides for the fields a test cares about. */
export function makeEvent(overrides: { eventId?: string; messageId?: string; text?: string; customerId?: string } = {}) {
  counter += 1;
  return {
    event_id: overrides.eventId ?? `evt_test_${Date.now()}_${counter}`,
    type: "message.received",
    brand_id: "verdant-co",
    timestamp: new Date(Date.now() + counter).toISOString(),
    customer: { id: overrides.customerId ?? "cust_1042", name: "Aisha Khan", phone: "+919800000001" },
    message: {
      id: overrides.messageId ?? `msg_test_${Date.now()}_${counter}`,
      type: "text",
      text: overrides.text ?? "What is your return policy?",
    },
  };
}

export function signed(body: unknown): { raw: string; signature: string } {
  const raw = JSON.stringify(body);
  return { raw, signature: signBody(raw, process.env.WEBHOOK_SECRET!) };
}

type FakeLlmHandler = (body: any) => Response | Promise<Response>;

/** Replaces the fake LLM's behaviour (see preload.ts); call with no argument to restore the default. */
export function setFakeLlm(handler?: FakeLlmHandler): void {
  (globalThis as any).__fakeLlm = handler ?? (globalThis as any).__defaultFakeLlm;
}

export function llmReply(content: string): Response {
  return Response.json({ model: "fake-model", choices: [{ message: { content } }] });
}

/** Resolves once no draft is `pending` any more (background generation has finished); throws if that takes too long. */
export async function waitForDrafts(timeoutMs = 5_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await pool.query("SELECT count(*)::int AS n FROM drafts WHERE status = 'pending'");
    if (r.rows[0].n === 0) return;
    await Bun.sleep(25);
  }
  throw new Error("drafts still pending");
}

/**
 * Gives background drafting from the previous test a moment to finish before the tables are wiped.
 * Unlike waitForDrafts it never fails: some tests deliberately leave drafts pending.
 */
export async function settleDrafts(): Promise<void> {
  await waitForDrafts(1_000).catch(() => {});
}

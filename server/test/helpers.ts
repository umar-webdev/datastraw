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

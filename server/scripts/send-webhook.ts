/**
 * Sends a signed test message to a webhook endpoint, exactly as the chat system would.
 *
 *   bun scripts/send-webhook.ts "What is your return policy?"
 *   bun scripts/send-webhook.ts --url https://your-app.onrender.com/webhook --customer cust_1043 "Do you deliver to Dubai?"
 *   bun scripts/send-webhook.ts --repeat-event evt_123 "Same event twice"      (dedup check)
 *   bun scripts/send-webhook.ts --bad-signature "Should get 401"
 *
 * Secret: WEBHOOK_SECRET env var, defaulting to the brief's test secret.
 */
import { parseArgs } from "node:util";
import { signBody } from "../src/lib/signature";
import { TEST_CUSTOMERS } from "../src/lib/testCustomers";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    url: { type: "string", default: "http://localhost:3000/webhook" },
    customer: { type: "string", default: "cust_1042" },
    "repeat-event": { type: "string" },
    "bad-signature": { type: "boolean", default: false },
  },
});

const text = positionals.join(" ") || "Hi, my order #4471 hasn't arrived yet. Can I change the delivery address?";
const known = TEST_CUSTOMERS.find((c) => c.id === values.customer);
const customer = known ?? { id: values.customer, name: "Webhook Tester", phone: "+919800000099" };
const secret = process.env.WEBHOOK_SECRET ?? "verdant-demo-secret-2026";

const body = JSON.stringify({
  event_id: values["repeat-event"] ?? `evt_${crypto.randomUUID().slice(0, 8)}`,
  type: "message.received",
  brand_id: "verdant-co",
  timestamp: new Date().toISOString(),
  customer,
  message: { id: `msg_${crypto.randomUUID().slice(0, 8)}`, type: "text", text },
});

const signature = values["bad-signature"] ? "sha256=" + "0".repeat(64) : signBody(body, secret);
const res = await fetch(values.url!, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Signature": signature },
  body,
});

console.log(`${res.status} ${res.statusText}`);
console.log(await res.text());

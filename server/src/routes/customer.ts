import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config";
import { pool } from "../db/pool";
import { limitPerIp } from "../middleware/rateLimit";
import { customerIdForPhone, TEST_CUSTOMERS } from "../lib/testCustomers";
import { MAX_MESSAGE_LENGTH, TextMessageEvent } from "../lib/webhookPayload";
import { scheduleDraft } from "../services/drafts";
import { ingestMessage } from "../services/ingest";

const SendMessageBody = z.object({
  customer: z.object({
    id: z
      .string()
      .regex(/^[\w-]{1,64}$/)
      .optional(),
    name: z.string().trim().min(1).max(200),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[\d\s-]{6,20}$/, "Enter a phone number"),
  }),
  text: z.string().trim().min(1, "Message is empty").max(MAX_MESSAGE_LENGTH),
});

function listTestCustomers(_req: Request, res: Response) {
  res.json({ customers: TEST_CUSTOMERS });
}

async function sendMessage(req: Request, res: Response) {
  const body = SendMessageBody.parse(req.body);

  // Build the same payload the webhook receives and run it through the same validation and ingest (decision D6).
  const event = TextMessageEvent.parse({
    event_id: `web_${randomUUID()}`,
    type: "message.received",
    brand_id: config.BRAND_ID,
    timestamp: new Date().toISOString(),
    customer: {
      id: body.customer.id ?? customerIdForPhone(body.customer.phone),
      name: body.customer.name,
      phone: body.customer.phone,
    },
    message: { id: `web_msg_${randomUUID()}`, type: "text", text: body.text },
  });

  const result = await ingestMessage(event, "customer_view");
  res.status(201).json({ ...result, customerId: event.customer.id });
  if (result.status === "accepted") scheduleDraft(result.draftId);
}

const ConversationQuery = z.object({ customerId: z.string().regex(/^[\w-]{1,200}$/) });

async function getConversation(req: Request, res: Response) {
  const { customerId } = ConversationQuery.parse(req.query);

  const conversation = await pool.query<{ id: string; name: string }>(
    `SELECT conv.id, c.name
     FROM customers c
     JOIN conversations conv ON conv.customer_id = c.id AND conv.status = 'open'
     WHERE c.brand_id = $1 AND c.external_id = $2`,
    [config.BRAND_ID, customerId],
  );
  const row = conversation.rows[0];
  if (!row) {
    res.json({ conversationId: null, messages: [] });
    return;
  }

  // Only the messages table: drafts are never selected here.
  const messages = await pool.query(
    `SELECT id, sender, text, sent_at AS "sentAt"
     FROM messages WHERE conversation_id = $1
     ORDER BY sent_at, created_at`,
    [row.id],
  );
  res.json({ conversationId: row.id, messages: messages.rows });
}

/**
 * The Customer view's endpoints. Unauthenticated by design (it's a test tool), so they only ever expose a
 * customer's own messages and approved agent replies, never drafts.
 */
export function createCustomerRouter() {
  const router = Router();
  router.get("/test-customers", listTestCustomers);
  router.post("/messages", limitPerIp(30), sendMessage);
  router.get("/conversation", getConversation);
  return router;
}

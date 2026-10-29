import { withTransaction } from "../db/pool";
import type { TextMessageEvent } from "../lib/webhookPayload";

export type IngestSource = "webhook" | "customer_view";

export type IngestResult =
  | { status: "accepted"; conversationId: string; messageId: string; draftId: string }
  | { status: "duplicate" };

const PREVIEW_LENGTH = 140;

/**
 * The single entry point for a customer message, used by both the webhook and the Customer view (decision D6).
 *
 * In one transaction: record the event (dedup), upsert the customer, find or open their conversation, save the
 * message, and replace any live draft with a new `pending` one. Either everything is saved or nothing is.
 * Drafting itself happens afterwards (see scheduleDraft), so a slow or failing LLM never loses a message.
 */
export async function ingestMessage(event: TextMessageEvent, source: IngestSource): Promise<IngestResult> {
  return withTransaction(async (db) => {
    const recorded = await db.query(
      `INSERT INTO webhook_events (event_id, source, payload) VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.event_id, source, event],
    );
    if (recorded.rowCount === 0) return { status: "duplicate" };

    // A different event_id carrying a message id we already stored is still the same message.
    const seen = await db.query(`SELECT 1 FROM messages WHERE external_id = $1`, [event.message.id]);
    if (seen.rowCount) return { status: "duplicate" };

    // ON CONFLICT DO UPDATE locks the customer row, so concurrent messages from one customer are handled one at a time.
    const customer = await db.query<{ id: string }>(
      `INSERT INTO customers (brand_id, external_id, name, phone) VALUES ($1, $2, $3, $4)
       ON CONFLICT (brand_id, external_id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone
       RETURNING id`,
      [event.brand_id, event.customer.id, event.customer.name, event.customer.phone],
    );
    const customerId = customer.rows[0]!.id;

    const text = event.message.text;
    const preview = text.length > PREVIEW_LENGTH ? text.slice(0, PREVIEW_LENGTH - 1) + "…" : text;
    const sentAt = event.timestamp;

    const existing = await db.query<{ id: string }>(
      `SELECT id FROM conversations WHERE customer_id = $1 AND status = 'open' FOR UPDATE`,
      [customerId],
    );
    const conversationId =
      existing.rows[0]?.id ??
      (
        await db.query<{ id: string }>(
          `INSERT INTO conversations (customer_id, last_message_at, last_message_preview)
           VALUES ($1, $2, $3) RETURNING id`,
          [customerId, sentAt, preview],
        )
      ).rows[0]!.id;

    // ON CONFLICT covers a concurrent delivery of the same message that slipped past the check above.
    const message = await db.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, sender, text, external_id, sent_at)
       VALUES ($1, 'customer', $2, $3, $4)
       ON CONFLICT (external_id) DO NOTHING
       RETURNING id`,
      [conversationId, text, event.message.id, sentAt],
    );
    if (message.rowCount === 0) return { status: "duplicate" };
    const messageId = message.rows[0]!.id;

    // Out-of-order deliveries must not move the conversation's "latest" backwards.
    await db.query(
      `UPDATE conversations
       SET last_message_preview = CASE WHEN $2 >= last_message_at THEN $3 ELSE last_message_preview END,
           last_message_at      = GREATEST(last_message_at, $2)
       WHERE id = $1`,
      [conversationId, sentAt, preview],
    );

    // One live draft per conversation: the new one answers everything outstanding (decision D15).
    await db.query(
      `UPDATE drafts SET status = 'superseded', updated_at = now()
       WHERE conversation_id = $1 AND status IN ('pending', 'ready', 'failed')`,
      [conversationId],
    );
    const draft = await db.query<{ id: string }>(
      `INSERT INTO drafts (conversation_id, message_id) VALUES ($1, $2) RETURNING id`,
      [conversationId, messageId],
    );

    return { status: "accepted", conversationId, messageId, draftId: draft.rows[0]!.id };
  });
}

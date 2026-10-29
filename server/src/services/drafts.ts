import { z } from "zod";
import { KB_VERSION } from "../ai/knowledgeBase";
import { completeChat } from "../ai/llmClient";
import { buildDraftMessages, HISTORY_LIMIT, type ChatMessage, type HistoryMessage } from "../ai/prompt";
import { pool, withTransaction } from "../db/pool";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../lib/logger";
import { toPreview } from "../lib/preview";

/** After this many attempts a draft stays `failed` until an agent clicks Regenerate. */
export const MAX_DRAFT_ATTEMPTS = 3;

const DraftOutput = z.object({
  reply: z.string().trim().min(1).max(1500),
  needs_attention: z.boolean(),
  reason: z.string().trim().max(500).default(""),
});
export type DraftOutput = z.infer<typeof DraftOutput>;

/** Parses the model's text into a draft, tolerating a ```json fence around the object. */
export function parseDraftOutput(content: string): DraftOutput {
  const unfenced = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(unfenced);
  } catch {
    throw new Error("model output is not valid JSON");
  }
  const parsed = DraftOutput.safeParse(json);
  if (!parsed.success) {
    throw new Error(`model output has the wrong shape: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  return parsed.data;
}

/** Calls the model; if its answer isn't the JSON we asked for, asks once more to fix it. */
export async function draftReply(history: HistoryMessage[]): Promise<DraftOutput & { model: string }> {
  const messages = buildDraftMessages(history);
  const first = await completeChat(messages);
  try {
    return { ...parseDraftOutput(first.content), model: first.model };
  } catch (err) {
    logger.warn({ error: (err as Error).message }, "draft output invalid, asking the model to repair it");
    const repair: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: first.content },
      {
        role: "user",
        content: 'That was not a valid JSON object. Reply with only {"reply": string, "needs_attention": boolean, "reason": string}.',
      },
    ];
    const second = await completeChat(repair);
    return { ...parseDraftOutput(second.content), model: second.model };
  }
}

/**
 * Generates the AI suggestion for one draft and saves it as `ready`, or `failed` with the error.
 *
 * Safe to call more than once: it only works on drafts that are still `pending` or `failed` and under the attempt
 * limit, and it never overwrites a draft that was superseded or approved while the model was thinking.
 */
export async function generateDraft(draftId: string): Promise<void> {
  const log = logger.child({ draftId });

  const claimed = await pool.query<{ conversation_id: string; attempts: number }>(
    `UPDATE drafts SET attempts = attempts + 1, updated_at = now()
     WHERE id = $1 AND status IN ('pending', 'failed') AND attempts < $2
     RETURNING conversation_id, attempts`,
    [draftId, MAX_DRAFT_ATTEMPTS],
  );
  const draft = claimed.rows[0];
  if (!draft) return; // already done, replaced, or out of attempts

  const started = Date.now();
  try {
    const history = await pool.query<HistoryMessage>(
      `SELECT sender, text FROM (
         SELECT sender, text, sent_at, created_at FROM messages
         WHERE conversation_id = $1
         ORDER BY sent_at DESC, created_at DESC
         LIMIT $2
       ) recent ORDER BY sent_at, created_at`,
      [draft.conversation_id, HISTORY_LIMIT],
    );
    const result = await draftReply(history.rows);

    const saved = await pool.query(
      `UPDATE drafts
       SET status = 'ready', text = $2, needs_attention = $3, reason = $4, model = $5, kb_version = $6,
           last_error = NULL, updated_at = now()
       WHERE id = $1 AND status IN ('pending', 'failed')`,
      [draftId, result.reply, result.needs_attention, result.reason || null, result.model, KB_VERSION],
    );
    if (saved.rowCount === 0) {
      log.info("draft was replaced or approved while generating; result discarded");
      return;
    }
    log.info(
      { attempt: draft.attempts, ms: Date.now() - started, needsAttention: result.needs_attention },
      "draft ready",
    );
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await pool.query(
      `UPDATE drafts SET status = 'failed', last_error = $2, updated_at = now()
       WHERE id = $1 AND status IN ('pending', 'failed')`,
      [draftId, message],
    );
    log.error({ attempt: draft.attempts, error: message }, "draft generation failed");
  }
}

/** Starts generating a draft in the background, so the HTTP response isn't held up by the model (decision D8). */
export function scheduleDraft(draftId: string): void {
  generateDraft(draftId).catch((err) => logger.error({ err, draftId }, "draft generation crashed"));
}

const LIVE = ["pending", "ready", "failed"];

/**
 * Saves the agent's (possibly edited) text as a reply and marks the draft approved, in one transaction.
 *
 * Any live draft can be approved, including one still `pending` or `failed`: a slow or broken model never stops an
 * agent from replying (decision D16). The conditional update means a double click, or two agents at once, can only
 * send one reply; a draft replaced by a newer customer message returns 409 so the agent sees that message first.
 */
export async function approveDraft(draftId: string, text: string, agentId: string) {
  return withTransaction(async (db) => {
    const draft = await db.query<{ conversation_id: string }>(
      `UPDATE drafts SET status = 'approved', updated_at = now()
       WHERE id = $1 AND status = ANY($2)
       RETURNING conversation_id`,
      [draftId, LIVE],
    );
    const row = draft.rows[0];
    if (!row) {
      const existing = await db.query<{ status: string }>("SELECT status FROM drafts WHERE id = $1", [draftId]);
      const status = existing.rows[0]?.status;
      if (!status) throw new HttpError(404, "Draft not found");
      throw new HttpError(
        409,
        status === "approved"
          ? "This draft was already approved"
          : "The customer sent a new message, so this draft was replaced. Please review the latest draft.",
      );
    }

    const message = await db.query<{ id: string; sender: string; text: string; sentAt: string }>(
      `INSERT INTO messages (conversation_id, sender, text, agent_id, sent_at)
       VALUES ($1, 'agent', $2, $3, now())
       RETURNING id, sender, text, sent_at AS "sentAt"`,
      [row.conversation_id, text, agentId],
    );
    const reply = message.rows[0]!;

    await db.query("UPDATE drafts SET approved_message_id = $2 WHERE id = $1", [draftId, reply.id]);
    const preview = toPreview(text);
    await db.query(
      `UPDATE conversations SET last_message_at = GREATEST(last_message_at, $2), last_message_preview = $3 WHERE id = $1`,
      [row.conversation_id, reply.sentAt, preview],
    );
    return reply;
  });
}

/** Throws away the current suggestion and asks the model again, with a fresh set of attempts. */
export async function regenerateDraft(draftId: string): Promise<void> {
  const reset = await pool.query(
    `UPDATE drafts
     SET status = 'pending', text = NULL, needs_attention = false, reason = NULL, attempts = 0, last_error = NULL,
         updated_at = now()
     WHERE id = $1 AND status IN ('ready', 'failed')`,
    [draftId],
  );
  if (reset.rowCount === 0) {
    const existing = await pool.query<{ status: string }>("SELECT status FROM drafts WHERE id = $1", [draftId]);
    const status = existing.rows[0]?.status;
    if (!status) throw new HttpError(404, "Draft not found");
    throw new HttpError(409, status === "pending" ? "A draft is already being written" : `This draft is ${status}`);
  }
  scheduleDraft(draftId);
}

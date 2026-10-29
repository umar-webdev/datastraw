import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config";
import { pool } from "../db/pool";
import { HttpError } from "../middleware/errorHandler";
import { requireAgent } from "../middleware/requireAgent";
import { MAX_MESSAGE_LENGTH } from "../lib/webhookPayload";
import { approveDraft, regenerateDraft } from "../services/drafts";

const LIST_LIMIT = 100;
const IdParam = z.object({ id: z.uuid() });
const ApproveBody = z.object({ text: z.string().trim().min(1, "Reply is empty").max(MAX_MESSAGE_LENGTH) });

/** Open conversations, newest activity first, with what the agent needs to triage them. */
async function listConversations(_req: Request, res: Response) {
  const { rows } = await pool.query(
    `SELECT conv.id,
            c.name AS "customerName",
            c.phone AS "customerPhone",
            conv.last_message_preview AS "preview",
            conv.last_message_at AS "lastMessageAt",
            last_msg.sender AS "lastSender",
            d.status AS "draftStatus",
            COALESCE(d.needs_attention, false) AS "needsAttention"
     FROM conversations conv
     JOIN customers c ON c.id = conv.customer_id
     LEFT JOIN drafts d ON d.conversation_id = conv.id AND d.status IN ('pending', 'ready', 'failed')
     LEFT JOIN LATERAL (
       SELECT sender FROM messages m
       WHERE m.conversation_id = conv.id
       ORDER BY m.sent_at DESC, m.created_at DESC
       LIMIT 1
     ) last_msg ON true
     WHERE conv.status = 'open' AND c.brand_id = $1
     ORDER BY conv.last_message_at DESC
     LIMIT $2`,
    [config.BRAND_ID, LIST_LIMIT],
  );
  res.json({ conversations: rows });
}

/** One conversation: customer, every message in order, and the live draft (if any). */
async function getConversation(req: Request, res: Response) {
  const { id } = IdParam.parse(req.params);

  const conversation = await pool.query(
    `SELECT conv.id, conv.status, c.name AS "customerName", c.phone AS "customerPhone", c.external_id AS "customerId"
     FROM conversations conv JOIN customers c ON c.id = conv.customer_id
     WHERE conv.id = $1 AND c.brand_id = $2`,
    [id, config.BRAND_ID],
  );
  if (!conversation.rows[0]) throw new HttpError(404, "Conversation not found");

  const [messages, draft] = await Promise.all([
    pool.query(
      `SELECT m.id, m.sender, m.text, m.sent_at AS "sentAt", a.name AS "agentName"
       FROM messages m LEFT JOIN agents a ON a.id = m.agent_id
       WHERE m.conversation_id = $1
       ORDER BY m.sent_at, m.created_at`,
      [id],
    ),
    pool.query(
      `SELECT id, message_id AS "messageId", status, text, needs_attention AS "needsAttention", reason,
              attempts, last_error AS "lastError", model, updated_at AS "updatedAt"
       FROM drafts
       WHERE conversation_id = $1 AND status IN ('pending', 'ready', 'failed')`,
      [id],
    ),
  ]);

  res.json({ conversation: conversation.rows[0], messages: messages.rows, draft: draft.rows[0] ?? null });
}

async function approve(req: Request, res: Response) {
  const { id } = IdParam.parse(req.params);
  const { text } = ApproveBody.parse(req.body);
  const message = await approveDraft(id, text, req.agent!.id);
  req.log.info({ draftId: id, agentId: req.agent!.id }, "draft approved");
  res.status(201).json({ message });
}

async function regenerate(req: Request, res: Response) {
  const { id } = IdParam.parse(req.params);
  await regenerateDraft(id);
  res.status(202).json({ status: "pending" });
}

export function createAgentRouter() {
  const router = Router();
  router.use(requireAgent);
  router.get("/conversations", listConversations);
  router.get("/conversations/:id", getConversation);
  router.post("/drafts/:id/approve", approve);
  router.post("/drafts/:id/regenerate", regenerate);
  return router;
}

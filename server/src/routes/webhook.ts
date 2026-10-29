import express, { Router } from "express";
import { config } from "../config";
import { verifySignature } from "../lib/signature";
import { TextMessageEvent, WebhookEnvelope } from "../lib/webhookPayload";
import { scheduleDraft } from "../services/drafts";
import { ingestMessage } from "../services/ingest";

export const webhookRouter = Router();

// Status codes for each edge case are listed in decision.md D17.
webhookRouter.post("/webhook", express.raw({ type: () => true, limit: "1mb" }), async (req, res) => {
  // The signature covers the exact bytes received, so check it before parsing anything.
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!verifySignature(rawBody, req.header("x-signature"), config.WEBHOOK_SECRET)) {
    req.log.warn("webhook rejected: bad or missing signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Body is not valid JSON" });
    return;
  }

  const envelope = WebhookEnvelope.parse(json); // ZodError → 400 via errorHandler
  const log = req.log.child({ eventId: envelope.event_id });

  if (envelope.brand_id !== config.BRAND_ID) {
    log.warn({ brandId: envelope.brand_id }, "webhook rejected: unknown brand");
    res.status(422).json({ error: `Unknown brand_id "${envelope.brand_id}"` });
    return;
  }

  // Acknowledge events we don't handle, so the sender doesn't keep retrying them.
  if (envelope.type !== "message.received" || envelope.message.type !== "text") {
    log.info({ type: envelope.type, messageType: envelope.message.type }, "webhook ignored");
    res.status(200).json({ status: "ignored", reason: "only text message.received events are handled" });
    return;
  }

  const event = TextMessageEvent.parse(json);
  const result = await ingestMessage(event, "webhook");

  if (result.status === "duplicate") {
    log.info("webhook duplicate, already handled");
    res.status(200).json(result);
    return;
  }

  log.info({ conversationId: result.conversationId, draftId: result.draftId }, "message ingested");
  res.status(200).json(result);
  scheduleDraft(result.draftId);
});

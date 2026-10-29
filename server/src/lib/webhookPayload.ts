import { z } from "zod";

export const MAX_MESSAGE_LENGTH = 4000; // matches the CHECK on messages.text

const id = z.string().trim().min(1).max(200);

/** Every event: enough to decide whether we handle it, before requiring a text body. */
export const WebhookEnvelope = z.object({
  event_id: id,
  type: z.string().min(1),
  brand_id: z.string().min(1),
  timestamp: z.iso.datetime({ offset: true }),
  customer: z.object({
    id,
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(3).max(32),
  }),
  message: z.object({
    id,
    type: z.string().min(1),
    text: z.string().optional(),
  }),
});

/** A `message.received` text event: the only kind this app stores. */
export const TextMessageEvent = WebhookEnvelope.extend({
  type: z.literal("message.received"),
  message: z.object({
    id,
    type: z.literal("text"),
    text: z.string().trim().min(1, "message.text is empty").max(MAX_MESSAGE_LENGTH),
  }),
});

export type TextMessageEvent = z.infer<typeof TextMessageEvent>;

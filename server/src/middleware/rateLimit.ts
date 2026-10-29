import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/** Per-IP limit, keyed on the IP captured by the requestId middleware (see the note there). */
export function limitPerIp(limit: number, windowMs = 60_000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.clientIp),
    message: { error: "Too many requests, please slow down." },
  });
}

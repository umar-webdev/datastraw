import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Per-IP limit, keyed on the IP captured by the requestId middleware (see the note there).
 * With `onlyFailures`, successful requests don't count, e.g. to slow down password guessing without
 * locking out agents who sign in correctly.
 */
export function limitPerIp(limit: number, { windowMs = 60_000, onlyFailures = false } = {}) {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests: onlyFailures,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.clientIp),
    message: { error: "Too many requests, please slow down." },
  });
}

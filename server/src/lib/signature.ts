import { createHmac, timingSafeEqual } from "node:crypto";

/** The `X-Signature` header value for a body: `sha256=<hex HMAC-SHA256 of the raw bytes>`. */
export function signBody(rawBody: Buffer | string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Checks an `X-Signature: sha256=<hex>` header against the exact bytes that were received.
 * Uses a constant-time comparison so the response time doesn't leak how much of the signature matched.
 */
export function verifySignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header?.trim() ?? "");
  if (!match?.[1]) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(match[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

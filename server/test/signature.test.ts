import { describe, expect, test } from "bun:test";
import { signBody, verifySignature } from "../src/lib/signature";

const secret = "verdant-demo-secret-2026";
const body = Buffer.from('{"event_id":"evt_1"}');

describe("verifySignature", () => {
  test("accepts the HMAC-SHA256 of the raw body", () => {
    expect(verifySignature(body, signBody(body, secret), secret)).toBe(true);
  });

  test("accepts an upper-case hex digest", () => {
    const header = "sha256=" + signBody(body, secret).slice(7).toUpperCase();
    expect(verifySignature(body, header, secret)).toBe(true);
  });

  test("rejects a missing or malformed header", () => {
    expect(verifySignature(body, undefined, secret)).toBe(false);
    expect(verifySignature(body, "", secret)).toBe(false);
    expect(verifySignature(body, signBody(body, secret).slice(7), secret)).toBe(false); // no sha256= prefix
    expect(verifySignature(body, "sha256=abc", secret)).toBe(false);
  });

  test("rejects a signature made with another secret", () => {
    expect(verifySignature(body, signBody(body, "wrong-secret"), secret)).toBe(false);
  });

  test("rejects a body changed after signing, even by whitespace", () => {
    const header = signBody(body, secret);
    expect(verifySignature(Buffer.from('{"event_id": "evt_1"}'), header, secret)).toBe(false);
  });

  test("matches a digest computed independently with openssl", () => {
    // printf '%s' '{"event_id":"evt_1"}' | openssl dgst -sha256 -hmac verdant-demo-secret-2026
    expect(signBody(body, secret)).toBe("sha256=802244f2d33349c865145af61b074cdcb942adcefccd998d64975a8d0f530c82");
  });
});

import { config } from "../config";
import { logger } from "../lib/logger";
import { pool } from "./pool";

/**
 * Makes sure the agent account from SEED_AGENT_EMAIL / SEED_AGENT_PASSWORD exists and that its password matches env.
 * Safe to run on every boot.
 */
export async function seedAgent(): Promise<void> {
  const email = config.SEED_AGENT_EMAIL.toLowerCase();
  const existing = await pool.query<{ id: string; password_hash: string }>(
    "SELECT id, password_hash FROM agents WHERE email = $1",
    [email],
  );
  const row = existing.rows[0];

  if (row && (await Bun.password.verify(config.SEED_AGENT_PASSWORD, row.password_hash))) return;

  const hash = await Bun.password.hash(config.SEED_AGENT_PASSWORD, { algorithm: "bcrypt", cost: 10 });
  if (row) {
    await pool.query("UPDATE agents SET password_hash = $1 WHERE id = $2", [hash, row.id]);
    logger.info({ email }, "seed agent password updated");
  } else {
    await pool.query("INSERT INTO agents (email, name, password_hash) VALUES ($1, $2, $3)", [
      email,
      "Support Agent",
      hash,
    ]);
    logger.info({ email }, "seed agent created");
  }
}

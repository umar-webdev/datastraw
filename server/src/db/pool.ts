import pg from "pg";
import { config } from "../config";
import { logger } from "../lib/logger";

const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(config.DATABASE_URL);

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  // Supabase requires SSL; a local Postgres usually has none.
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => logger.error({ err }, "idle postgres client error"));

/** Runs `fn` inside a transaction, rolling back if it throws. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function isDbHealthy(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

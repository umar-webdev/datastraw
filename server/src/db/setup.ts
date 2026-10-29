import { logger } from "../lib/logger";
import { runMigrations } from "./migrate";
import { pool } from "./pool";
import { seedAgent } from "./seed";

/** Migrations + seed. Runs on every server boot; `bun run db:setup` runs it on its own. */
export async function setupDatabase(): Promise<void> {
  await runMigrations();
  await seedAgent();
}

if (import.meta.main) {
  try {
    await setupDatabase();
    logger.info("database ready");
  } catch (err) {
    logger.error({ err }, "database setup failed");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

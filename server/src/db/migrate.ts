import { readdir } from "node:fs/promises";
import path from "node:path";
import { logger } from "../lib/logger";
import { pool } from "./pool";

const migrationsDir = path.join(import.meta.dir, "migrations");
// Arbitrary constant: only one process at a time may run migrations (e.g. two instances booting together).
const MIGRATION_LOCK_ID = 727_001;

/** Applies every `NNN_name.sql` file not yet recorded in schema_migrations, in order, each in its own transaction. */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    // Same reason as in 001_init.sql: keep it out of reach of Supabase's public REST API.
    await client.query("ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY");

    const applied = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );
    const files = (await readdir(migrationsDir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await Bun.file(path.join(migrationsDir, file)).text();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        logger.info({ migration: file }, "migration applied");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

import { createApp } from "./app";
import { config } from "./config";
import { pool } from "./db/pool";
import { setupDatabase } from "./db/setup";
import { logger } from "./lib/logger";
import { startSweeper } from "./services/sweeper";

try {
  await setupDatabase();
} catch (err) {
  logger.fatal({ err }, "database setup failed, not starting");
  process.exit(1);
}

const server = createApp().listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "server listening");
});
const stopSweeper = startSweeper();

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopSweeper();
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

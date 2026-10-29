import { createApp } from "./app";
import { config } from "./config";
import { pool } from "./db/pool";
import { logger } from "./lib/logger";

const server = createApp().listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "server listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

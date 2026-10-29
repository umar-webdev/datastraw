import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { isDbHealthy } from "./db/pool";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";

// Built React app, served from the same origin as the API (see decision D3).
const clientDist = path.resolve(import.meta.dir, "../../client/dist");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Render's proxy: needed for rate limiting by IP
  app.use(requestId);

  app.get("/health", async (_req, res) => {
    const db = await isDbHealthy();
    res.status(db ? 200 : 503).json({ ok: db, db });
  });

  // The webhook route must be mounted before express.json(): it needs the raw body for the signature.
  app.use("/api", express.json({ limit: "100kb" }));
  app.use("/api", notFound);

  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    // SPA fallback: let React Router handle any other GET.
    app.get(/^(?!\/(api|webhook|health)).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

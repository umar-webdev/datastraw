import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: typeof logger;
    }
  }
}

// Gives every request an id and a child logger, so all log lines for one request can be found together.
export function requestId(req: Request, res: Response, next: NextFunction) {
  req.id = req.header("x-request-id") ?? randomUUID();
  req.log = logger.child({ requestId: req.id });
  res.setHeader("x-request-id", req.id);

  const start = Date.now();
  res.on("finish", () => {
    req.log.info(
      { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start },
      "request",
    );
  });
  next();
}

import type { CookieOptions, NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config, isProduction } from "../config";

export type SessionAgent = { id: string; email: string; name: string };

declare global {
  namespace Express {
    interface Request {
      agent?: SessionAgent;
    }
  }
}

export const SESSION_COOKIE = "verdant_session";
const SESSION_HOURS = 12;

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true, // not readable by page scripts
  secure: isProduction, // HTTPS only in production
  sameSite: "lax", // not sent on cross-site POSTs
  path: "/",
};

export function startSession(res: Response, agent: SessionAgent): void {
  const token = jwt.sign({ email: agent.email, name: agent.name }, config.JWT_SECRET, {
    subject: agent.id,
    expiresIn: `${SESSION_HOURS}h`,
    algorithm: "HS256",
  });
  res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions, maxAge: SESSION_HOURS * 3600 * 1000 });
}

export function endSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
}

/** Lets the request through only with a valid, unexpired session cookie, and sets req.agent (decision D13). */
export function requireAgent(req: Request, res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string") {
    res.status(401).json({ error: "Please sign in" });
    return;
  }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    req.agent = { id: payload.sub!, email: payload.email, name: payload.name };
    next();
  } catch {
    endSession(res);
    res.status(401).json({ error: "Your session has expired, please sign in again" });
  }
}

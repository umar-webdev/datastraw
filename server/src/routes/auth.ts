import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { limitPerIp } from "../middleware/rateLimit";
import { endSession, requireAgent, startSession } from "../middleware/requireAgent";

const LoginBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

// Compared against when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = await Bun.password.hash("not-a-real-password", { algorithm: "bcrypt", cost: 10 });

async function login(req: Request, res: Response) {
  const { email, password } = LoginBody.parse(req.body);
  const found = await pool.query<{ id: string; email: string; name: string; password_hash: string }>(
    "SELECT id, email, name, password_hash FROM agents WHERE email = $1",
    [email],
  );
  const agent = found.rows[0];
  const valid = await Bun.password.verify(password, agent?.password_hash ?? DUMMY_HASH);

  if (!agent || !valid) {
    req.log.info({ email }, "login failed");
    res.status(401).json({ error: "Wrong email or password" });
    return;
  }

  startSession(res, agent);
  req.log.info({ agentId: agent.id }, "agent signed in");
  res.json({ agent: { id: agent.id, email: agent.email, name: agent.name } });
}

function logout(_req: Request, res: Response) {
  endSession(res);
  res.status(204).end();
}

function me(req: Request, res: Response) {
  res.json({ agent: req.agent });
}

export function createAuthRouter() {
  const router = Router();
  router.post("/login", limitPerIp(10, { onlyFailures: true }), login);
  router.post("/logout", logout);
  router.get("/me", requireAgent, me);
  return router;
}

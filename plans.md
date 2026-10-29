# Build Plan

Time box: **~4.5 hours of build** + submission work. Deadline: 7 days from receipt. Each phase ends in something that works and is committed.

Design is in [architecture.md](architecture.md), reasons are in [decision.md](decision.md).

---

## Phase 0 — Setup (20 min)

- [x] **Git:** `DataStraw/` is its own repo, so nothing from the home folder gets committed. Create the GitHub repo.
- [x] Bun workspaces: root `package.json` with `client` and `server`.
- [x] `server`: Express + TS run by Bun (`bun --watch`), pino, zod, pg, jsonwebtoken, cookie-parser, express-rate-limit (`Bun.password` replaces bcrypt).
- [x] `client`: Vite `react-ts` template, React Router, TanStack Query; Vite dev server proxies `/api`, `/webhook` and `/health` to the server.
- [x] `.gitignore` (`node_modules`, `dist`, `.env`), `.env.example`, `config.ts` (zod env validation).
- [ ] Supabase project created and `DATABASE_URL` in `.env`.
- [x] LLM free-tier key obtained; check that a test curl returns a completion.

**Done when:** `bun run dev` starts both apps; `/health` returns `{ ok: true, db: true }`.

---

## Phase 1 — Database (25 min)

- [x] `001_init.sql`: `agents`, `customers`, `conversations` (+ partial unique index), `messages`, `drafts`, `webhook_events`, indexes.
- [x] `migrate.ts`: `schema_migrations` table, runs pending files in order inside a transaction, on boot.
- [x] Seed: one agent from `SEED_AGENT_EMAIL/PASSWORD` (bcrypt), idempotent.

**Done when:** a fresh DB migrates and seeds; re-running does nothing.

---

## Phase 2 — Ingest + webhook (50 min) ⭐ core

- [x] `lib/signature.ts`: `verifySignature(rawBody, header, secret)` — parse `sha256=`, HMAC, `timingSafeEqual`, length check first.
- [x] zod `WebhookPayload` schema matching the spec format.
- [x] `services/ingest.ts` `ingestMessage(payload, source)` — single transaction: dedup event → upsert customer → get/create open conversation → insert message → update conversation preview → supersede live drafts → insert `pending` draft. Returns ids + `duplicate` flag.
- [x] `routes/webhook.ts`: `express.raw` → verify → parse/validate → ignore non-text → brand check → ingest → `200` → kick off `generateDraft` (stub for now).
- [x] `routes/customer.ts`: `POST /api/customer/messages` (builds webhook-shaped payload), `GET /api/customer/conversation`, `GET /api/customer/test-customers`.
- [x] `scripts/send-webhook.ts` (or `.sh`): signs and POSTs a sample payload — used locally, against prod, and in the README.
- [x] Tests: signature valid / invalid / missing; duplicate event → one message; second message → same conversation.

**Done when:** a signed curl creates customer + conversation + message + pending draft; a replay returns `duplicate: true`; a bad signature returns 401.

---

## Phase 3 — AI drafting (45 min) ⭐ core

- [x] `ai/knowledgeBase.ts`: KB text exactly as given + `KB_VERSION`.
- [x] `ai/prompt.ts`: system prompt (rules from architecture §6), last 20 messages as chat turns, JSON output instruction.
- [x] `ai/llmClient.ts`: fetch `/chat/completions`, `AbortController` 20 s timeout, 1 retry on 429/5xx with backoff, JSON parse + zod, one repair attempt.
- [x] `services/drafts.ts` `generateDraft(id)`: conditional claim → call → `ready` / `failed` with `last_error`; never overwrite `superseded`.
- [x] `services/sweeper.ts`: on boot + every 60 s.
- [x] Run all 5 sample messages and check the outputs by hand against the expected table in architecture §6. Tune the prompt until Dubai and allergy get `needs_attention` and the COD ₹3,500 answer is a clear "no".

**Done when:** sending a message produces a `ready` draft within seconds; killing the LLM key produces `failed` with an error, and the sweeper retries.

---

## Phase 4 — Agent auth + API (30 min)

- [x] `POST /api/auth/login` (rate limited), `POST /api/auth/logout`, `GET /api/auth/me`.
- [x] `requireAgent` middleware (verify JWT cookie → `req.agent`).
- [x] `GET /api/agent/conversations` — name, preview, time, live draft status / needs_attention; `ORDER BY last_message_at DESC LIMIT 100`.
- [x] `GET /api/agent/conversations/:id` — customer, messages, live draft.
- [x] `POST /api/agent/drafts/:id/approve` — conditional update, `409` on conflict, insert agent message, update conversation.
- [x] `POST /api/agent/drafts/:id/regenerate` — reset attempts, set `pending`, kick off generation.
- [x] Central error handler (zod → 400, known errors → status, unknown → 500 with requestId, no stack in prod).
- [x] Tests: approve happy path; double approve → 409; approve superseded → 409; agent routes without cookie → 401.

---

## Phase 5 — Frontend (70 min)

- [x] `App.tsx`: top bar with `Customer | Agent` toggle (NavLinks to `/customer` and `/agent`).
- [x] `api/` typed fetch helpers (`credentials: 'include'`, throw on non-2xx with server message).
- [x] **Customer view:** test customer picker (3 seeded + "new customer" name/phone form, remembered in localStorage), thread (customer right, agent left), composer, sample-message chips, poll 4 s, optimistic "sending…".
- [x] **Login page**, protected route wrapper (calls `/me`, redirects to login).
- [x] **Conversation list:** name, preview, relative time, status badge; poll 5 s; click → page.
- [x] **Conversation page:** thread, draft panel — spinner (`pending`), textarea pre-filled (`ready`), warning + reason (`needs_attention`), error + empty editor (`failed`); Approve (disabled while saving / empty), Regenerate; on 409 refetch + toast.
- [x] Minimal clean CSS; works on laptop width. Empty/loading/error states everywhere.

**Done when:** the full "You are done when" checklist passes locally.

---

## Phase 6 — Deploy (30 min)

- [ ] Express serves `client/dist` + SPA fallback for non-API routes.
- [ ] Root `build` (client) and `start` (`bun server/src/index.ts`) scripts.
- [ ] Dockerfile on `oven/bun`; Render web service from it, env vars, health check `/health`.
- [ ] Supabase: use the pooled connection string, SSL on.
- [ ] Production smoke test: run the done-checklist on the live URL + `send-webhook` script against the live `/webhook`.
- [ ] Uptime ping (cron-job.org → `/health` every 10 min) to avoid cold starts during review.

---

## Phase 7 — Submission (30 min, outside build time)

- [ ] README (≤1 page): run locally, stack + why, main decisions, what was cut, AI-tool help + one thing it got wrong, the two answers (draft in decision.md).
- [ ] Check that no secrets are in git history (`git log -p | grep -i key`).
- [ ] Demo video ≤3 min: end-to-end flow (customer → agent → approve → customer) → webhook via curl → Dubai/allergy `needs_attention` → one key decision (async drafts + sweeper) → one improvement.
- [ ] Submit the Google Form: live URL, agent test login, webhook URL, repo link, video link.
- [ ] Keep the deployment live until Datastraw replies.

---

## Final acceptance checklist (from the brief)

- [ ] Customer view → send a sample message → Agent view → sign in → message is there.
- [ ] Conversation shows an AI-drafted reply.
- [ ] Edit draft → Approve → Customer view shows the approved reply (and never a draft).
- [ ] Signed POST straight to `/webhook` gives the same result.
- [ ] Bad signature → 401; duplicate `event_id` → no duplicate message.
- [ ] LLM failure → message still visible, "Draft failed", agent can still reply.
- [ ] Out-of-KB question (Dubai) → honest draft, flagged for attention.
- [ ] Runs locally from the README alone.

## Cut list (if running over time, cut in this order)
1. Regenerate button (the sweeper still retries).
2. Typed-in custom customers (keep the seeded test customers).
3. Rate limiting on the customer endpoints (keep it on login).
4. Integration tests for approve (keep the signature + ingest tests).

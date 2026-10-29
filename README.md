# Verdant & Co — AI-drafted support replies

**Live:** https://verdant-support.onrender.com · **Webhook:** `POST https://verdant-support.onrender.com/webhook` · Agent login: `agent@verdant.test` (password in the submission form)

Customer messages arrive by signed webhook (or the Customer view, which goes through the same code path) and are stored in Postgres. An LLM drafts a reply from the knowledge base, and an agent edits and approves it. More detail: [architecture.md](architecture.md), [decision.md](decision.md).

**Stack:** React 19 + Vite + TanStack Query · Express 5 + TypeScript on Bun · Postgres (Supabase) · Gemini via its OpenAI-compatible API · one Docker service on Render.

## Run locally
Needs [Bun](https://bun.sh) ≥ 1.1.21, a Postgres database (Supabase or local) and a Gemini key ([aistudio.google.com](https://aistudio.google.com/apikey)).
```bash
bun install
cp .env.example .env        # fill in DATABASE_URL, LLM_API_KEY, JWT_SECRET, SEED_AGENT_PASSWORD
bun run db:setup            # migrations + seeds the agent account
bun run dev                 # http://localhost:5173 (API on :3000)
```
Send a signed webhook: `cd server && bun scripts/send-webhook.ts "Do you deliver to Dubai?"` (add `--url <live>/webhook`, `--bad-signature` or `--repeat-event evt_1`). With curl, sign the exact bytes you send. Put the body in a file so `₹` stays UTF-8 (this matters on Windows):
```bash
sig=$(openssl dgst -sha256 -hmac "verdant-demo-secret-2026" body.json | sed 's/^.* //')
curl -X POST localhost:3000/webhook -H "Content-Type: application/json" -H "X-Signature: sha256=$sig" --data-binary @body.json
```
Tests (57, need a throwaway local Postgres; they refuse to run against Supabase): `cd server && TEST_DATABASE_URL=postgresql://postgres@localhost:5432/verdant_test bun test`

## Main decisions
- **Save first, draft later.** The webhook verifies the HMAC over the raw body, stores the message in one transaction, returns 200, and only then calls the LLM. A slow or failing model never loses a message or makes the sender retry. Duplicates are caught on both `event_id` and the message id.
- **Drafts can fail without blocking anyone.** Each draft has a status (pending / ready / failed / approved / superseded). The LLM call has a timeout, one retry (optionally on a fallback model) and a sweeper that retries stuck drafts up to 3 times. A failed draft shows "Draft failed", and the agent can still type a reply or regenerate.
- **Whole KB in the prompt, JSON out.** The KB is 7 entries, so retrieval would add failure modes for no gain. The model returns `{reply, needs_attention, reason}`. It is told to answer only from the KB, give both delivery ranges rather than guess metro status, never invent order details, and flag out-of-KB or health questions (Dubai, allergies) for the agent.
- **One live draft per conversation.** A new customer message supersedes the old draft (enforced by a unique index). Approving is a conditional update, so approving a stale draft or approving twice returns 409 instead of sending the wrong reply.
- **Simple and same-origin.** One service serves the API and the built SPA. Agent auth is bcrypt plus a JWT in an httpOnly cookie. The UI polls every 4–5 s instead of using WebSockets.

## What I cut
Outbound sending to WhatsApp · closing/reopening conversations in the UI · multi-brand, roles, assignment and unread state · real-time push and pagination (lists capped at 100) · a draft-quality evaluation harness · browser E2E tests (the API is covered by integration tests).

## How AI tools helped, and one thing they got wrong
I used Claude Code to plan the phases and decisions, write the code and tests, and run the end-to-end checks in a browser. **What it got wrong:** the SPA fallback it wrote sent `index.html` with status 200 for *any* unknown path, including missing `/assets/*.js` files. After a redeploy, a browser holding the old page would load HTML as JavaScript and show a blank screen with no clear error. I caught it while checking the production build: missing assets now return 404, and there's a test for it. (It also defaulted to `gemini-2.5-flash`, which returns 404 for new API keys.)

## Two questions
**1. A message arrives at 2 a.m. and something fails. What does the agent see, and how do you find out?** The message is saved in the same transaction that accepts the webhook. Unless the database itself is down (the sender gets a 500 and retries), it is there in the morning. If the LLM failed, the sweeper has already retried. If it still failed, the conversation shows "Draft failed" with Regenerate, and the agent can reply by hand. To find out why: the draft stores `last_error` and its attempt count. The JSON logs carry the `draftId`/`eventId`, and the raw payload is kept in `webhook_events` for replay. Next step: an alert when failed drafts pile up.

**2. This has to serve 20 brands. What changes first?** Make `brand_id` a real tenant key: a `brands` table with each brand's webhook secret and KB stored in the database, and `brand_id` on agents and conversations. Every query and auth check is scoped by brand, with Postgres row-level security as a backstop. That's what stops one brand's agents seeing another brand's customers, or replies built from the wrong policies. After that: a real queue for drafts, and retrieval once KBs grow.

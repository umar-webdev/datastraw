# Decision Log

Short ADR-style records: context → decision → why → trade-off / when to revisit. These feed the "main decisions" section of the README and the demo video.

---

## D1. React + Vite SPA for the frontend
- **Decision:** React 19 + TypeScript + Vite, React Router, TanStack Query.
- **Why:** The brief prefers React and it's what I'm most fluent in. Vite is the fastest setup with no framework magic. TanStack Query handles fetching, caching, polling and mutation refetch, so there's no hand-written loading or state code.
- **Trade-off:** No SSR. Not needed for an internal tool behind sign-in.

## D2. Separate Node + Express backend (not Next.js API routes or Supabase Edge Functions)
- **Decision:** Express + TypeScript, one long-running process.
- **Why:** The webhook must reply quickly, and drafting continues after the response. A long-running process can do that, and it can run a sweeper timer. On serverless this needs `waitUntil` or a queue. Express is plain and easy for someone else to take over.
- **Trade-off:** One more moving part than a pure-Supabase setup. Revisit with a real job queue at scale (see D9).

## D3. One deployed service serving API + built SPA (same origin)
- **Decision:** Express serves `client/dist` as static files. One Render service, one URL.
- **Why:** The auth cookie works with no CORS or `SameSite=None` setup. There's one URL to submit and one deploy to keep alive.
- **Trade-off:** You can't scale the frontend and API separately. That doesn't matter here.
- **Note:** Render's free tier sleeps after ~15 min idle, and the first request can take 30–60 s. Mitigation: a free uptime ping (cron-job.org every 10 min) during the review window, plus the sweeper recovers drafts after a restart. Use Railway if cold starts turn out to be a problem.

## D4. PostgreSQL on Supabase, accessed with `pg` and plain SQL migrations
- **Decision:** Supabase only as hosted Postgres. Queries use `pg` with parameterised SQL. Migrations are numbered `.sql` files run on boot.
- **Why:** The reviewers use Supabase and Postgres every day. Plain SQL makes the data model obvious, and constraints like the partial unique index are written out directly. No ORM to learn.
- **Trade-off:** No generated types. Row types are written by hand in TypeScript, which is fine at this size.

## D5. Data model: customers → conversations → messages, with drafts as a separate table
- **Decision:** Drafts are not messages. They have their own lifecycle (`pending/ready/failed/approved/superseded`) and link to the customer message they answer. Approving creates a real `agent` message.
- **Why:** This keeps "what was said to the customer" (messages) separate from "what the AI suggested" (drafts). Customer endpoints only read `messages`, so a draft can never leak to the customer. Keeping the draft after approval lets us compare the AI text with what was actually sent, which is useful for judging quality later.
- **One open conversation per customer** is enforced by a partial unique index (`WHERE status='open'`), not just app code, so two simultaneous webhooks can't create two open conversations.
- **Denormalised `last_message_at` / `last_message_preview`** on conversations keeps the list query a single indexed scan.

## D6. One `ingestMessage()` code path for webhook and Customer view
- **Decision:** The Customer view endpoint builds a webhook-shaped payload and calls the same service function. It doesn't make an HTTP call to `/webhook`.
- **Why:** The spec requires these to be "handled exactly like" each other. Sharing the function guarantees it without signing requests in the browser, which would expose the secret.

## D7. Idempotency at two layers
- **Decision:** `webhook_events.event_id` primary key (`ON CONFLICT DO NOTHING`), and `messages.external_id` unique.
- **Why:** Webhook senders retry on timeouts. Without dedup, a retry creates a duplicate message and a second LLM call. A duplicate returns `200` so the sender stops retrying.

## D8. Respond 200 after the DB commit, generate the draft asynchronously
- **Decision:** The webhook saves the message and a `pending` draft in one transaction, replies `200`, then calls the LLM.
- **Why:** LLM calls take 1–10 s and sometimes fail. Making the sender wait risks timeouts and retries, and an LLM outage would also block messages from being saved. The message is the critical data and the draft is a bonus.
- **Trade-off:** For a moment the agent sees "Drafting…". Polling picks the draft up within seconds.

## D9. In-process worker + DB-backed sweeper instead of a queue
- **Decision:** Fire-and-forget `generateDraft()` after the response, plus a 60 s sweeper that retries `pending` (stale) and `failed` drafts, up to 3 attempts. Claiming is a conditional `UPDATE`, so two runners can't both process the same draft.
- **Why:** The draft status in Postgres is the queue. It survives crashes and restarts and needs no extra infrastructure. This is enough for one brand's volume.
- **When it stops working:** with several server instances or high volume. Then move to a real queue (pg-boss on the same Postgres, or SQS / Cloud Tasks).

## D10. Retrieval: put the whole knowledge base in the prompt
- **Decision:** No embeddings or vector DB. The full KB (~350 tokens) goes in the system prompt, with a `KB_VERSION` recorded on each draft.
- **Why:** With 8 short policies, retrieval can only make things worse: a retriever can miss the one relevant policy, but the full text can't. It's cheap, simple and easy to debug.
- **When it stops working:** when the KB is roughly 20–50k tokens or more (long FAQs, product catalogues), or across many brands where cost and latency per call grow. Then: split the KB into chunks, use hybrid keyword + embedding search (pgvector in the same Supabase DB), take the top-k into the prompt, and log which chunks each draft used.

## D11. Structured JSON output with a `needs_attention` flag
- **Decision:** The LLM returns `{ reply, needs_attention, reason }`, validated with zod.
- **Why:** The reviewers specifically test behaviour when the KB lacks the answer (Dubai) and for safety cases (allergy). The model is told not to guess and to flag these cases, so the agent sees a "Needs attention" badge and a one-line reason. A schema also catches malformed output before an agent sees it.
- **Trade-off:** Some free models follow JSON instructions poorly, so we do one repair retry and then mark the draft `failed`. The agent can still write a reply.

## D12. LLM provider behind an OpenAI-compatible client
- **Decision:** One small `fetch`-based client for `/chat/completions`, configured by `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`. Default is a free-tier provider (Gemini's OpenAI-compatible endpoint or OpenRouter).
- **Why:** Free tiers change and rate-limit. Switching providers should be an env change, not a code change. A plain `fetch` with `AbortController` gives explicit timeouts and retries.

## D13. Simple agent auth: DB users + bcrypt + JWT in an httpOnly cookie
- **Decision:** Agent accounts are seeded from env, bcrypt-hashed. Login sets a 12 h JWT in an `httpOnly; Secure; SameSite=Lax` cookie. Login is rate-limited.
- **Why:** The brief asks for "any simple, sensible approach". An httpOnly cookie can't be read by injected JS, and on a same-origin deploy CSRF exposure is limited by SameSite=Lax plus JSON-only APIs. Supabase Auth would also work but ties the backend to Supabase's SDK and JWT setup for little gain.
- **Left out:** sign-up, password reset, roles. Agents are seeded.

## D14. Polling instead of WebSockets / Supabase Realtime
- **Decision:** TanStack Query `refetchInterval` (4–5 s) on the list, the conversation and the customer thread.
- **Why:** No connection handling and it works through any proxy or cold start. A few seconds of delay is fine for a support inbox.
- **When to revisit:** with many agents or when instant updates matter. Then use SSE or Supabase Realtime.

## D15. Draft supersession: one live draft per conversation
- **Decision:** When a new customer message arrives, the previous unapproved draft is marked `superseded`, and a new draft is written using the full recent history.
- **Why:** Customers often send 2–3 messages in a row. One up-to-date draft that answers all of them is better than three stale ones. Approving a superseded draft returns `409`, so an agent can't send a reply that ignores the newest message.

## D16. Failed drafts never block a human reply
- **Decision:** Approve is allowed when the draft status is `failed`. The editor is empty and the agent types the reply.
- **Why:** The AI only assists. An LLM outage should slow agents down, not stop them.

## D18. Bun for runtime, package manager and tests
- **Decision:** Bun runs the server's TypeScript directly (`bun --watch` in dev, no `tsc` build), manages the workspaces (`bun install`), runs Vite for the client and runs the tests (`bun test`). Passwords use `Bun.password` (bcrypt), so no native `bcrypt` package is needed. `tsc --noEmit` is only a typecheck.
- **Why:** It's one tool instead of node + npm + tsx + vitest, installs and starts faster, and has fewer moving parts for someone taking the project over.
- **What stays standard:** Express, `pg` and Vite are used unchanged. The code doesn't depend on Bun-only APIs beyond `Bun.password`, so moving back to Node later is small. I kept `pg` rather than Bun's built-in SQL client because `pg` is battle-tested with Supabase's pooler.
- **Deploy:** a Dockerfile on the `oven/bun` image, so Render runs exactly the Bun version used locally.

## D17. Webhook responses for edge cases
| Case | Response | Why |
|---|---|---|
| Missing/invalid signature | 401 | not from the trusted sender |
| Invalid JSON / schema | 400 + field errors | sender bug, retry won't help |
| Unknown `brand_id` | 422 | single-brand deployment |
| Non-text / other event type | 200 `{ignored:true}` | acknowledge so it isn't retried forever, and log it |
| Duplicate `event_id` | 200 `{duplicate:true}` | idempotent |
| DB error | 500 | retryable; the transaction leaves no partial rows |

---

## Deliberately left out (time box)
- Real WhatsApp / outbound sending (out of scope per brief).
- Closing or reopening conversations from the UI (the status column exists, there's just no UI).
- Multi-brand tenancy, roles, agent assignment, read/unread state.
- Real-time push, typing indicators, pagination (lists are capped at 100).
- Evaluation harness for draft quality beyond the 5 sample messages.
- Full E2E browser tests. Unit and integration tests cover signature, ingest, idempotency and approve.

---

## Answers to the two README questions (draft)

**1. A message arrives at 2 a.m. and something fails. What does the agent see, and how do you find out?**
The message is saved in the same transaction that accepts the webhook. So unless the database itself was down (the sender gets a 500 and retries), the agent sees it in the morning. The conversation shows "Draft failed" with an empty editor and a Regenerate button. To find the cause, I'd look up the draft's stored `last_error` and attempt count. Then I'd search the structured logs for its `draftId`/`eventId`, and the raw payload is kept in `webhook_events` for replay.

**2. This has to serve 20 brands. What changes first?**
First I'd make `brand_id` a real tenant key: a `brands` table with each brand's webhook secret and its knowledge base stored in the database, and `brand_id` on agents and conversations. Every query and auth check would be scoped by brand (Postgres row-level security as a safety net). That's the change that stops one brand's agents seeing another brand's customers or getting replies built from the wrong policies. Next, I'd move draft generation to a real queue, and add retrieval once knowledge bases get large.

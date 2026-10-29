// Loaded before every test file (bunfig.toml). Tests run against TEST_DATABASE_URL only, never the dev database:
// each DB test file wipes the tables it uses.
const testDb = process.env.TEST_DATABASE_URL;
if (testDb && /supabase\.(co|com)/.test(testDb)) {
  throw new Error("TEST_DATABASE_URL points at Supabase. Use a throwaway local database for tests.");
}

Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "error",
  DATABASE_URL: testDb ?? "postgresql://unused@localhost:1/unused",
  WEBHOOK_SECRET: "verdant-demo-secret-2026",
  JWT_SECRET: "test-jwt-secret-0123456789",
  LLM_API_KEY: "test",
  LLM_MODEL: "test-model",
  LLM_FALLBACK_MODEL: "test-fallback-model",
  SEED_AGENT_EMAIL: "agent@verdant.test",
  SEED_AGENT_PASSWORD: "test-password",
});

// Fake LLM: a real local HTTP server speaking the OpenAI-compatible API. Its answer comes from the current handler
// (see setFakeLlm in helpers.ts), so tests exercise the real LLM client, timeouts and retries included.
export type FakeLlmHandler = (body: any) => Response | Promise<Response>;
const defaultHandler: FakeLlmHandler = () =>
  Response.json({
    model: "fake-model",
    choices: [{ message: { content: '{"reply":"Fake draft.","needs_attention":false,"reason":""}' } }],
  });
(globalThis as any).__fakeLlm = defaultHandler;
(globalThis as any).__defaultFakeLlm = defaultHandler;

const fakeLlm = Bun.serve({
  port: 0,
  async fetch(req) {
    return (globalThis as any).__fakeLlm(await req.json());
  },
});
process.env.LLM_BASE_URL = `http://localhost:${fakeLlm.port}/v1`;

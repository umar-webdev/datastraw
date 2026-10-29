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
  LLM_BASE_URL: "http://localhost:1/llm",
  LLM_API_KEY: "test",
  LLM_MODEL: "test-model",
  SEED_AGENT_EMAIL: "agent@verdant.test",
  SEED_AGENT_PASSWORD: "test-password",
});

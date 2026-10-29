import { z } from "zod";

// All configuration comes from env vars. The server refuses to start if any are missing.
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  WEBHOOK_SECRET: z.string().min(1),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  LLM_BASE_URL: z.string().url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  SEED_AGENT_EMAIL: z.string().email(),
  SEED_AGENT_PASSWORD: z.string().min(8),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // Single-brand deployment: webhooks for any other brand are rejected.
  BRAND_ID: z.string().min(1).default("verdant-co"),
});

export type Config = z.infer<typeof EnvSchema>;

function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
export const isProduction = config.NODE_ENV === "production";

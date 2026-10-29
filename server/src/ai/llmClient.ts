import { config } from "../config";
import { logger } from "../lib/logger";
import type { ChatMessage } from "./prompt";

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export type LlmResult = { content: string; model: string };

type Provider = { baseUrl: string; apiKey: string; model: string };

const primary: Provider = { baseUrl: config.LLM_BASE_URL, apiKey: config.LLM_API_KEY, model: config.LLM_MODEL };
const fallback: Provider | undefined = config.LLM_FALLBACK_MODEL
  ? {
      baseUrl: config.LLM_FALLBACK_BASE_URL ?? config.LLM_BASE_URL,
      apiKey: config.LLM_FALLBACK_API_KEY ?? config.LLM_API_KEY,
      model: config.LLM_FALLBACK_MODEL,
    }
  : undefined;

// Try 1 uses the primary model; the one retry uses the fallback when one is configured, else the primary again.
const TRIES: Provider[] = [primary, fallback ?? primary];
const MAX_RETRY_WAIT_MS = 5_000;

/**
 * Calls any OpenAI-compatible `/chat/completions` endpoint (decision D12) and returns the message text.
 * Each try has its own timeout. Failures a retry could fix (rate limits, server errors, timeouts, network) are
 * retried once, on the fallback model if one is set.
 */
export async function completeChat(messages: ChatMessage[]): Promise<LlmResult> {
  for (let attempt = 0; ; attempt++) {
    const provider = TRIES[attempt]!;
    try {
      return await requestOnce(messages, provider);
    } catch (err) {
      const error = err instanceof LlmError ? err : new LlmError(String(err), true);
      const next = TRIES[attempt + 1];
      if (!error.retryable || !next) throw error;
      // Wait before asking the same model again; switching to a different one can go straight away.
      const waitMs = next === provider ? Math.min(error.retryAfterMs ?? 1_500, MAX_RETRY_WAIT_MS) : 0;
      logger.warn({ model: provider.model, nextModel: next.model, waitMs, error: error.message }, "LLM call failed, retrying");
      await Bun.sleep(waitMs);
    }
  }
}

async function requestOnce(messages: ChatMessage[], provider: Provider): Promise<LlmResult> {
  let res: Response;
  try {
    res = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(config.LLM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new LlmError(
      timedOut ? `LLM timed out after ${config.LLM_TIMEOUT_MS}ms (${provider.model})` : `LLM unreachable: ${err}`,
      true,
    );
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    const retryAfterSeconds = Number(res.headers.get("retry-after"));
    throw new LlmError(
      `LLM HTTP ${res.status} (${provider.model}): ${detail}`,
      res.status === 429 || res.status >= 500,
      retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : undefined,
    );
  }

  const body = (await res.json().catch(() => null)) as {
    model?: string;
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  } | null;
  const content = body?.choices?.[0]?.message?.content;
  if (!content) {
    const reason = body?.choices?.[0]?.finish_reason ?? "no choices";
    throw new LlmError(`LLM returned no content (${reason}, ${provider.model})`, true);
  }
  return { content, model: body?.model ?? provider.model };
}

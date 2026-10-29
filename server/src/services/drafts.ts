import { logger } from "../lib/logger";

/**
 * Starts generating the AI draft for a pending draft row, without blocking the caller.
 * Phase 3 replaces this stub with the LLM call; until then drafts stay `pending`.
 */
export function scheduleDraft(draftId: string): void {
  logger.debug({ draftId }, "draft generation not implemented yet");
}

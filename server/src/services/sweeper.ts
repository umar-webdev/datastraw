import { pool } from "../db/pool";
import { logger } from "../lib/logger";
import { generateDraft, MAX_DRAFT_ATTEMPTS } from "./drafts";

const SWEEP_INTERVAL_MS = 60_000;
// A draft claimed less than this long ago may still be in progress, so it's left alone.
// Must stay longer than the worst case of one generation (two LLM tries with timeouts, plus a repair call).
const STALE_AFTER_SECONDS = 90;
const BATCH_SIZE = 10;

let running = false;

/**
 * Retries drafts that are stuck `pending` (e.g. the server restarted mid-generation) or `failed` and still under
 * the attempt limit (decision D9). Drafts are processed one at a time to stay gentle on free-tier rate limits.
 */
export async function sweepDrafts(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const due = await pool.query<{ id: string }>(
      `SELECT id FROM drafts
       WHERE status IN ('pending', 'failed') AND attempts < $1
         AND updated_at < now() - make_interval(secs => $2)
       ORDER BY updated_at
       LIMIT $3`,
      [MAX_DRAFT_ATTEMPTS, STALE_AFTER_SECONDS, BATCH_SIZE],
    );
    for (const { id } of due.rows) await generateDraft(id);
    if (due.rowCount) logger.info({ count: due.rowCount }, "sweeper retried drafts");
    return due.rowCount ?? 0;
  } catch (err) {
    logger.error({ err }, "draft sweep failed");
    return 0;
  } finally {
    running = false;
  }
}

export function startSweeper(): () => void {
  void sweepDrafts(); // pick up anything left over from before a restart
  const timer = setInterval(() => void sweepDrafts(), SWEEP_INTERVAL_MS);
  return () => clearInterval(timer);
}

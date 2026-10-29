const PREVIEW_LENGTH = 140;

/** The short text shown for a conversation in the agent's list. */
export function toPreview(text: string): string {
  return text.length > PREVIEW_LENGTH ? text.slice(0, PREVIEW_LENGTH - 1) + "…" : text;
}

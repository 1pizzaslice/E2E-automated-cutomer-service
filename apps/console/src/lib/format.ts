/** Locale date-time for a timestamp; falls back to the raw string if unparsable. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Compact age like `42s`, `7m`, `3h`, `2d` from an ISO timestamp. */
export function formatAge(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();

  if (Number.isNaN(then)) {
    return "—";
  }

  const seconds = Math.max(0, Math.round((now - then) / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours}h`;
  }

  return `${Math.round(hours / 24)}d`;
}

const DRAFT_KEYS = ["draft", "body_text", "body", "text", "message", "reply"];

/**
 * The editable text of a reply draft payload. Approval `requested_payload`s are
 * arbitrary JSON; a reply carries its text under one of a few known keys. When
 * none matches, the caller edits the whole payload as JSON instead.
 */
export function draftField(
  payload: Record<string, unknown>,
): { readonly key: string; readonly text: string } | null {
  for (const key of DRAFT_KEYS) {
    const value = payload[key];

    if (typeof value === "string") {
      return { key, text: value };
    }
  }

  return null;
}

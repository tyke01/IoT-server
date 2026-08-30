const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export type LimitParseResult =
  | { ok: true; limit: number }
  | { ok: false; error: string };

/**
 * A query string value is always a string or missing, never a number.
 * Same treatment as any other input from outside the program.
 */
export function parseLimit(raw: string | undefined): LimitParseResult {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, limit: DEFAULT_LIMIT };
  }

  const limit = Number(raw);

  if (!Number.isInteger(limit)) {
    return { ok: false, error: `'limit' must be a whole number, got "${raw}"` };
  }

  if (limit < 1 || limit > MAX_LIMIT) {
    return { ok: false, error: `'limit' must be between 1 and ${MAX_LIMIT}, got ${limit}` };
  }

  return { ok: true, limit };
}
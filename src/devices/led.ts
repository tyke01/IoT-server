import type { LedCommandParseResult, LedState } from "../types/index.ts";

const VALID_STATES: LedState[] = ["ON", "OFF"];

/**
 * Checks a request body from the outside world. Same job as the DHT22 parser,
 * different direction: this data came from a browser instead of a device.
 */
export function parseLedCommandBody(body: unknown): LedCommandParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body must be a JSON object" };
  }

  if (!("state" in body)) {
    return { ok: false, error: "body must contain a 'state' field" };
  }

  const { state } = body;

  if (typeof state !== "string") {
    return { ok: false, error: "'state' must be a string" };
  }

  const upper = state.toUpperCase();

  if (upper !== "ON" && upper !== "OFF") {
    return {
      ok: false,
      error: `'state' must be one of ${VALID_STATES.join(", ")}, got "${state}"`,
    };
  }

  return { ok: true, state: upper };
}

/** What actually goes on the wire. The firmware compares against this exactly. */
export function ledCommandPayload(state: LedState): string {
  return state;
}
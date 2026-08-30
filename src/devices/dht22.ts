import type { Dht22ParseResult } from "../types/index.js";

/**
 * Turns a raw MQTT payload into a reading, or explains why it could not.
 * Every check here exists because the payload came from outside this program.
 */
export function parseDht22Payload(payload: string): Dht22ParseResult {
  let data: unknown;

  try {
    data = JSON.parse(payload);
  } catch {
    return { ok: false, error: "payload is not valid JSON" };
  }

  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "payload is not a JSON object" };
  }

  if (!("temperature" in data) || !("humidity" in data)) {
    return { ok: false, error: "payload is missing 'temperature' or 'humidity'" };
  }

  const { temperature, humidity } = data;

  if (typeof temperature !== "number" || !Number.isFinite(temperature)) {
    return { ok: false, error: "'temperature' is not a finite number" };
  }

  if (typeof humidity !== "number" || !Number.isFinite(humidity)) {
    return { ok: false, error: "'humidity' is not a finite number" };
  }

  return { ok: true, reading: { temperature, humidity } };
}
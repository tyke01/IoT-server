import type { DeviceId } from "./device.js";

/**
 * The payload shape the device publishes. Nothing more, nothing less.
 * If the firmware changes what it sends, this type changes with it.
 */
export interface Dht22Reading {
  temperature: number;
  humidity: number;
}

/**
 * A reading after the server has handled it: who sent it and when it arrived.
 * Deliberately separate from Dht22Reading. See the README for why.
 */
export interface TelemetryRecord {
  deviceId: DeviceId;
  temperature: number;
  humidity: number;
  receivedAt: Date;
}

/**
 * Either a reading or a reason there is no reading. Never both, never neither.
 */
export type Dht22ParseResult =
  | { ok: true; reading: Dht22Reading }
  | { ok: false; error: string };
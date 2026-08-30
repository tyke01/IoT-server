import { config } from "../config/env.ts";
import type { DeviceId } from "../types/index.ts";

const base = config.mqtt.baseTopic;

/** Every device's DHT readings. '+' matches exactly one level, the device id. */
export function telemetrySubscription(): string {
  return `${base}/+/sensors/dht`;
}

/** Every device's heartbeat. */
export function healthSubscription(): string {
  return `${base}/+/health`;
}

/** One specific device's LED command topic. Used from step 7. */
export function ledCommandTopic(deviceId: DeviceId): string {
  return `${base}/${deviceId}/commands/led`;
}

export function isTelemetryTopic(topic: string): boolean {
  return topic.endsWith("/sensors/dht");
}

export function isHealthTopic(topic: string): boolean {
  return topic.endsWith("/health");
}

/**
 * Pulls the device id out of a topic string.
 * Returns null rather than throwing: an unrecognised topic is not a crash.
 */
export function deviceIdFromTopic(topic: string): DeviceId | null {
  const baseLength = base.split("/").length;
  const segments = topic.split("/");
  const deviceId = segments[baseLength];

  if (deviceId === undefined || deviceId === "") {
    return null;
  }

  return deviceId;
}
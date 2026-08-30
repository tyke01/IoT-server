import type { DeviceId, TelemetryRecord } from "../types/index.js";

/**
 * The most recent reading from each device. Lost on restart, by design.
 * Step 8 adds the database that survives one.
 */
const latestByDevice = new Map<DeviceId, TelemetryRecord>();

export function saveLatest(record: TelemetryRecord): void {
  latestByDevice.set(record.deviceId, record);
}

export function getLatest(deviceId: DeviceId): TelemetryRecord | null {
  return latestByDevice.get(deviceId) ?? null;
}

export function getAllLatest(): TelemetryRecord[] {
  return Array.from(latestByDevice.values());
}

export function deviceCount(): number {
  return latestByDevice.size;
}
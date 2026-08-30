import type {
  DeviceHealth,
  DeviceResponse,
  TelemetryRecord,
  TelemetryResponse,
} from "../types/index.ts";

/** Date to ISO string. The only place that conversion happens. */
export function toTelemetryResponse(record: TelemetryRecord): TelemetryResponse {
  return {
    deviceId: record.deviceId,
    temperature: record.temperature,
    humidity: record.humidity,
    receivedAt: record.receivedAt.toISOString(),
  };
}

export function toDeviceResponse(
  health: DeviceHealth,
  latest: TelemetryRecord | null
): DeviceResponse {
  return {
    deviceId: health.deviceId,
    status: health.status,
    lastSeenAt: health.lastSeenAt.toISOString(),
    latest: latest === null ? null : toTelemetryResponse(latest),
  };
}
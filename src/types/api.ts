import type { DeviceId, DeviceStatus, LedState } from "./device.js";

/**
 * What the API sends, not what the server holds. Dates are ISO strings here
 * because JSON has no date type.
 */
export interface TelemetryResponse {
  deviceId: DeviceId;
  temperature: number;
  humidity: number;
  receivedAt: string;
}

export interface DeviceResponse {
  deviceId: DeviceId;
  status: DeviceStatus;
  lastSeenAt: string;
  latest: TelemetryResponse | null;
}

export interface LedCommandResponse {
  deviceId: DeviceId;
  state: LedState;
  sentAt: string;
}

export interface ServerHealthResponse {
  status: "ok";
  uptimeSeconds: number;
}

export interface ErrorResponse {
  error: string;
}
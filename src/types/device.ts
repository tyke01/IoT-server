/**
 * Identifies one physical device. Matches the {deviceId} segment in every topic.
 */
export type DeviceId = string;

/** The only two states the LED can be commanded into. */
export type LedState = "ON" | "OFF";

/** Whether we have heard from a device recently enough to call it alive. */
export type DeviceStatus = "online" | "offline";

export interface DeviceHealth {
  deviceId: DeviceId;
  status: DeviceStatus;
  lastSeenAt: Date;
}

export interface LedCommand {
  deviceId: DeviceId;
  state: LedState;
}

/** Either a usable state or a reason the request body was rejected. */
export type LedCommandParseResult =
  | { ok: true; state: LedState }
  | { ok: false; error: string };
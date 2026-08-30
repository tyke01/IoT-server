import type { DeviceHealth, DeviceId } from "../types/index.js";

/**
 * The firmware publishes a heartbeat every 5 seconds. Three missed in a row is a
 * problem worth reporting; one is a wifi hiccup.
 */
const OFFLINE_AFTER_MS = 15_000;

const lastSeenByDevice = new Map<DeviceId, Date>();

/** Any message from a device proves it is alive, not only the health topic. */
export function recordSeen(deviceId: DeviceId, at: Date): void {
  lastSeenByDevice.set(deviceId, at);
}

export function getHealth(deviceId: DeviceId): DeviceHealth | null {
  const lastSeenAt = lastSeenByDevice.get(deviceId);

  if (lastSeenAt === undefined) {
    return null;
  }

  const age = Date.now() - lastSeenAt.getTime();

  return {
    deviceId,
    status: age > OFFLINE_AFTER_MS ? "offline" : "online",
    lastSeenAt,
  };
}

export function getAllHealth(): DeviceHealth[] {
  const all: DeviceHealth[] = [];

  for (const deviceId of lastSeenByDevice.keys()) {
    const health = getHealth(deviceId);

    if (health !== null) {
      all.push(health);
    }
  }

  return all;
}
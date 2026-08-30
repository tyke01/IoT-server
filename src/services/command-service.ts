import { ledCommandPayload } from "../devices/led.ts";
import { ledCommandTopic } from "../devices/topics.ts";
import { logger } from "../utils/logger.ts";
import type { DeviceId, LedCommand, LedState, PublishFn } from "../types/index.ts";

/**
 * Publishes an LED command. Returning successfully means the broker accepted it,
 * not that the device acted on it. Nothing here can know that yet.
 */
export async function sendLedCommand(
  publish: PublishFn,
  deviceId: DeviceId,
  state: LedState
): Promise<LedCommand> {
  const topic = ledCommandTopic(deviceId);

  await publish(topic, ledCommandPayload(state));
  logger.info(`Sent ${state} to ${deviceId} on ${topic}`);

  return { deviceId, state };
}
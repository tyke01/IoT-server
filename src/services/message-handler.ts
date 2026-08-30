import { parseDht22Payload } from "../devices/dht22.js";
import {
  deviceIdFromTopic,
  isHealthTopic,
  isTelemetryTopic,
} from "../devices/topics.js";
import { logger } from "../utils/logger.js";
import type { TelemetryRecord } from "../types/index.js";
import { recordSeen } from "./device-health.js";
import { deviceCount, saveLatest } from "./telemetry-store.js";
import { saveReading } from "../database/telemetry-repository.js";

export async function handleMessage(
  topic: string,
  payload: string
): Promise<void> {
  const deviceId = deviceIdFromTopic(topic);

  if (deviceId === null) {
    logger.warn(`Could not read a device id from topic ${topic}`);
    return;
  }

  const receivedAt = new Date();
  recordSeen(deviceId, receivedAt);

  if (isTelemetryTopic(topic)) {
    const result = parseDht22Payload(payload);

    if (!result.ok) {
      logger.warn(`Discarded a payload from ${deviceId}: ${result.error}`, payload);
      return;
    }

    const record: TelemetryRecord = {
      deviceId,
      temperature: result.reading.temperature,
      humidity: result.reading.humidity,
      receivedAt,
    };

    saveLatest(record);
    await saveReading(record);

    logger.info(
      `Stored ${record.temperature}C ${record.humidity}% from ${deviceId}, ` +
        `${deviceCount()} device(s) tracked`
    );
    return;
  }

  if (isHealthTopic(topic)) {
    logger.info(`Heartbeat from ${deviceId}`);
    return;
  }

  logger.warn(`No handler for topic ${topic}`);
}
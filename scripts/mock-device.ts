/**
 * Pretends to be an ESP32 with a DHT22 attached.
 *
 * It publishes to exactly the same topics with exactly the same payload shapes
 * as the real firmware, so the server cannot tell the difference.
 *
 * Run it with:  npm run mock
 */
import mqtt from "mqtt";
import "dotenv/config";

import { config } from "../src/config/env.js";
import { logger } from "../src/utils/logger.js";

const deviceId = process.env.MOCK_DEVICE_ID ?? "esp32-01";
const base = `${config.mqtt.baseTopic}/${deviceId}`;

const client = mqtt.connect(config.mqtt.url, {
  clientId: `mock-${deviceId}-${Math.random().toString(16).slice(2, 8)}`,
  username: config.mqtt.username,
  password: config.mqtt.password,
  clean: true,
});

/** Random walk, so the numbers look like a room instead of a noise generator. */
let temperature = 24.0;
let humidity = 60.0;

function drift(value: number, step: number, min: number, max: number): number {
  const next = value + (Math.random() - 0.5) * step;
  return Math.min(max, Math.max(min, Number(next.toFixed(1))));
}

client.on("connect", () => {
  logger.info(`Mock device ${deviceId} connected, publishing to ${base}`);

  setInterval(() => {
    client.publish(`${base}/health`, "alive");
  }, 5000);

  setInterval(() => {
    temperature = drift(temperature, 0.6, 18, 34);
    humidity = drift(humidity, 2.0, 30, 90);

    const payload = JSON.stringify({ temperature, humidity });
    client.publish(`${base}/sensors/dht`, payload);
    logger.info(`Published ${payload}`);
  }, 3000);

  client.subscribe(`${base}/commands/led`, () => {
    logger.info("Listening for LED commands");
  });
});

client.on("message", (topic, message) => {
  logger.info(`Mock LED command received on ${topic}`, message.toString());
});

client.on("error", (error) => {
  logger.error("Mock device error", error.message);
});

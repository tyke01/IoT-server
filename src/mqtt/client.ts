import mqtt from "mqtt";
import type { MqttClient } from "mqtt";

import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

export function connectToBroker(): MqttClient {
  logger.info(`Connecting to broker at ${config.mqtt.url}`);

  const client = mqtt.connect(config.mqtt.url, {
    clientId: config.mqtt.clientId,
    username: config.mqtt.username,
    password: config.mqtt.password,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on("connect", () => {
    logger.info(`Connected as ${config.mqtt.clientId}`);
  });

  client.on("reconnect", () => {
    logger.warn("Reconnecting to broker");
  });

  client.on("close", () => {
    logger.warn("Broker connection closed");
  });

  client.on("error", (error) => {
    logger.error("Broker error", error.message);
  });

  return client;
}

export function subscribe(client: MqttClient, topics: string[]): void {
  client.subscribe(topics, { qos: 1 }, (error) => {
    if (error) {
      logger.error("Failed to subscribe", error.message);
      return;
    }
    logger.info(`Subscribed to ${topics.join(", ")}`);
  });
}

export function onMessage(
  client: MqttClient,
  handler: (topic: string, payload: string) => void | Promise<void>
): void {
  client.on("message", (topic, payload) => {
    // mqtt.js does not await this callback, so a rejected promise would be an
    // unhandled rejection and would take the process down. Catch it here.
    void Promise.resolve(handler(topic, payload.toString())).catch(
      (error: unknown) => {
        logger.error("Message handler failed", error);
      }
    );
  });
}

/**
 * QoS 1 for commands: the broker keeps retrying until it is acknowledged.
 * A dropped temperature reading is replaced in 3 seconds. A dropped command
 * is a light that never comes on.
 */
export function publish(
  client: MqttClient,
  topic: string,
  payload: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos: 1 }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function disconnect(client: MqttClient): Promise<void> {
  return new Promise((resolve) => {
    client.end(false, {}, () => resolve());
  });
}
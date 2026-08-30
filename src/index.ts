import {
  connectToBroker,
  subscribe,
  onMessage,
  publish,
  disconnect,
} from "./mqtt/client.js";
import { healthSubscription, telemetrySubscription } from "./devices/topics.js";
import { handleMessage } from "./services/message-handler.js";
import { startApiServer } from "./api/server.js";
import { logger } from "./utils/logger.js";
import type { PublishFn } from "./types/index.js";

async function main(): Promise<void> {
  logger.info("Starting IoT server");

  // The API is handed a way to publish, not the MQTT client itself.
  const publishMessage: PublishFn = (topic, payload) =>
    publish(client, topic, payload);

  const app = await startApiServer(publishMessage);

  const client = connectToBroker();
  subscribe(client, [telemetrySubscription(), healthSubscription()]);
  onMessage(client, handleMessage);

  // Without this, Ctrl+C kills the process while the broker still believes
  // we are connected, and the client id stays taken for a while.
  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down");
    await app.close();
    await disconnect(client);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  logger.error("Server failed to start", error);
  process.exit(1);
});

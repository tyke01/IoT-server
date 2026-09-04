import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";

import { config } from "../config/env.ts";
import { logger } from "../utils/logger.ts";
import { registerCommandRoutes } from "./routes/commands.ts";
import { registerDeviceRoutes } from "./routes/devices.ts";
import { registerSystemRoutes } from "./routes/system.ts";
import { registerTelemetryRoutes } from "./routes/telemetry.ts";
import type { PublishFn } from "../types/index.ts";
import { registerAgentRoutes } from "./routes/agent.js";

export async function startApiServer(
  publish: PublishFn
): Promise<FastifyInstance> {
  const app = Fastify();

  // Without this, a browser refuses to read the response. See the README.
  await app.register(cors, { origin: config.http.corsOrigin });

  registerSystemRoutes(app);
  registerTelemetryRoutes(app);
  registerDeviceRoutes(app);
  registerCommandRoutes(app, publish);
  registerAgentRoutes(app);

  await app.listen({ port: config.http.port, host: config.http.host });
  logger.info(`API listening on http://${config.http.host}:${config.http.port}`);

  return app;
}
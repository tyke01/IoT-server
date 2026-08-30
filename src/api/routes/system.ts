import type { FastifyInstance } from "fastify";

import type { ServerHealthResponse } from "../../types/index.js";

/**
 * Is this server running? Nothing to do with whether the ESP32 is.
 * Deployment tools poll this, so it must not touch the broker or the database.
 */
export function registerSystemRoutes(app: FastifyInstance): void {
  app.get("/health", (): ServerHealthResponse => {
    return {
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
    };
  });
}
import type { FastifyInstance } from "fastify";

import { getAllHealth, getHealth } from "../../services/device-health.js";
import { getLatest } from "../../services/telemetry-store.js";
import { toDeviceResponse } from "../serialize.js";

interface DeviceParams {
  deviceId: string;
}

export function registerDeviceRoutes(app: FastifyInstance): void {
  app.get("/api/devices", () => {
    return getAllHealth().map((health) =>
      toDeviceResponse(health, getLatest(health.deviceId))
    );
  });

  app.get<{ Params: DeviceParams }>("/api/devices/:deviceId", (request, reply) => {
    const health = getHealth(request.params.deviceId);

    if (health === null) {
      return reply
        .code(404)
        .send({ error: `Unknown device ${request.params.deviceId}` });
    }

    return toDeviceResponse(health, getLatest(health.deviceId));
  });
}
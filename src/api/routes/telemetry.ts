import type { FastifyInstance } from "fastify";

import {
  findRecentReadings,
  findRecentReadingsByDevice,
} from "../../database/telemetry-repository.js";
import { getAllLatest, getLatest } from "../../services/telemetry-store.js";
import { toTelemetryResponse } from "../serialize.js";
import { parseLimit } from "../../database/parse-query.js";

interface DeviceParams {
  deviceId: string;
}

interface LimitQuery {
  limit?: string;
}

export function registerTelemetryRoutes(app: FastifyInstance): void {
  app.get("/api/telemetry/latest", () => {
    return getAllLatest().map(toTelemetryResponse);
  });

  app.get<{ Params: DeviceParams }>(
    "/api/telemetry/latest/:deviceId",
    (request, reply) => {
      const record = getLatest(request.params.deviceId);

      if (record === null) {
        return reply
          .code(404)
          .send({ error: `No reading stored for device ${request.params.deviceId}` });
      }

      return toTelemetryResponse(record);
    }
  );

  app.get<{ Querystring: LimitQuery }>(
    "/api/telemetry/history",
    async (request, reply) => {
      const parsed = parseLimit(request.query.limit);

      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error });
      }

      const records = await findRecentReadings(parsed.limit);
      return records.map(toTelemetryResponse);
    }
  );

  app.get<{ Params: DeviceParams; Querystring: LimitQuery }>(
    "/api/telemetry/history/:deviceId",
    async (request, reply) => {
      const parsed = parseLimit(request.query.limit);

      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error });
      }

      const records = await findRecentReadingsByDevice(
        request.params.deviceId,
        parsed.limit
      );
      return records.map(toTelemetryResponse);
    }
  );
}
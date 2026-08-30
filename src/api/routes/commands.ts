import type { FastifyInstance } from "fastify";

import { parseLedCommandBody } from "../../devices/led.ts";
import { sendLedCommand } from "../../services/command-service.ts";
import type { LedCommandResponse, PublishFn } from "../../types/index.ts";

interface DeviceParams {
  deviceId: string;
}

export function registerCommandRoutes(
  app: FastifyInstance,
  publish: PublishFn
): void {
  app.post<{ Params: DeviceParams }>(
    "/api/devices/:deviceId/led",
    async (request, reply) => {
      const parsed = parseLedCommandBody(request.body);

      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error });
      }

      const command = await sendLedCommand(
        publish,
        request.params.deviceId,
        parsed.state
      );

      // 202, not 200: the broker took it. Whether the LED changed is unknown.
      const response: LedCommandResponse = {
        deviceId: command.deviceId,
        state: command.state,
        sentAt: new Date().toISOString(),
      };

      return reply.code(202).send(response);
    }
  );
}
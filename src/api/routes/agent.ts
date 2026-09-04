import type { FastifyInstance } from "fastify";

import { config } from "../../config/env.js";
import { askAgent } from "../../agent/loop.js";
import { createChatFn } from "../../agent/openai-client.js";
import { parseAskBody } from "../../agent/question.js";
import { logger } from "../../utils/logger.js";

export function registerAgentRoutes(app: FastifyInstance): void {
  // Built once. Creating a client per request would be wasteful and would
  // also mean a missing key failed differently on every call.
  const chat = config.llm.configured ? createChatFn() : null;

  app.post("/api/agent/ask", async (request, reply) => {
    if (chat === null) {
      return reply.code(503).send({
        error:
          "The agent is not configured. Set LLM_API_KEY, LLM_BASE_URL and LLM_MODEL in .env",
      });
    }

    const parsed = parseAskBody(request.body);

    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }

    try {
      const answer = await askAgent(chat, parsed.question, config.llm.maxSteps);
      return answer;
    } catch (error: unknown) {
      // A provider outage or a rate limit must not look like a server bug.
      logger.error("Agent request failed", error);
      return reply
        .code(502)
        .send({ error: "The language model provider could not be reached." });
    }
  });
}
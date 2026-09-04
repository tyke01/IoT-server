/**
 * Checks whether your configured provider actually supports tool calling
 * through its OpenAI-compatible endpoint.
 *
 * One request. Run it before wiring up the agent, and again whenever you
 * switch provider or model.
 *
 *   npx tsx scripts/verify-llm-provider.ts
 */
import OpenAI from "openai";

import { config } from "../src/config/env.js";
import { logger } from "../src/utils/logger.js";

async function main(): Promise<void> {
  if (!config.llm.configured) {
    logger.error("LLM_API_KEY is not set. Fill it in .env first.");
    process.exit(1);
  }

  logger.info(`Provider: ${config.llm.baseUrl}`);
  logger.info(`Model:    ${config.llm.model}`);

  const client = new OpenAI({
    apiKey: config.llm.apiKey,
    baseURL: config.llm.baseUrl,
  });

  const started = Date.now();

  const response = await client.chat.completions.create({
    model: config.llm.model,
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content:
          "What is the latest temperature for device esp32-01? Use the tool.",
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "get_latest_reading",
          description: "Get the most recent reading for one device.",
          parameters: {
            type: "object",
            properties: {
              deviceId: { type: "string", description: "Exact device id" },
            },
            required: ["deviceId"],
          },
        },
      },
    ],
  });

  const elapsed = Date.now() - started;
  const choice = response.choices[0];
  const calls = choice?.message.tool_calls ?? [];

  logger.info(`Responded in ${elapsed}ms`);

  if (calls.length === 0) {
    logger.error("FAIL: the model did not call the tool.");
    logger.error("It replied with text instead:", choice?.message.content);
    logger.error(
      "This model or endpoint does not support tool calling. Try another model."
    );
    process.exit(1);
  }

  const call = calls[0];

  if (call === undefined || call.type !== "function") {
    logger.error("FAIL: unexpected tool call shape", call);
    process.exit(1);
  }

  logger.info(`PASS: called '${call.function.name}'`);
  logger.info(`Arguments: ${call.function.arguments}`);

  try {
    const parsed: unknown = JSON.parse(call.function.arguments);
    logger.info("Arguments parsed as JSON:", parsed);
  } catch {
    logger.warn(
      "Arguments were not valid JSON. The agent handles this, but it is a sign " +
        "this model is weak at tool calling."
    );
  }

  logger.info("Usage:", response.usage);
}

main().catch((error: unknown) => {
  logger.error("Request failed", error);
  logger.error(
    "A 429 means you are rate limited. A 404 usually means the model name is " +
      "wrong for this provider."
  );
  process.exit(1);
});
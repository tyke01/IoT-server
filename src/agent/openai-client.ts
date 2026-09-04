import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

import { config } from "../config/env.js";
import { agentTools } from "./tools.js";
import type { AssistantTurn, ChatFn, ChatMessage } from "../types/index.js";

/**
 * Our ChatMessage shape into the provider's wire format. The same boundary
 * discipline used everywhere else: what we hold and what we send are
 * different types, converted in one place.
 */
function toProviderMessage(message: ChatMessage): ChatCompletionMessageParam {
  switch (message.role) {
    case "system":
      return { role: "system", content: message.content };

    case "user":
      return { role: "user", content: message.content };

    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.argumentsJson },
        })),
      };

    case "tool":
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
  }
}

function toProviderTools(): ChatCompletionTool[] {
  return agentTools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Builds the real ChatFn. Any OpenAI-compatible provider works: Groq, Gemini's
 * compatibility endpoint, Mistral, OpenRouter, or a local Ollama. Only
 * LLM_BASE_URL and LLM_MODEL change.
 */
export function createChatFn(): ChatFn {
  const client = new OpenAI({
    apiKey: config.llm.apiKey,
    baseURL: config.llm.baseUrl,
  });

  return async (messages: ChatMessage[]): Promise<AssistantTurn> => {
    const response = await client.chat.completions.create({
      model: config.llm.model,
      messages: messages.map(toProviderMessage),
      tools: toProviderTools(),
      max_tokens: 1024,
    });

    const choice = response.choices[0];

    if (choice === undefined) {
      return { text: null, toolCalls: [] };
    }

    const rawCalls = choice.message.tool_calls ?? [];

    const toolCalls = rawCalls.flatMap((call) =>
      call.type === "function"
        ? [
            {
              id: call.id,
              name: call.function.name,
              argumentsJson: call.function.arguments,
            },
          ]
        : []
    );

    return { text: choice.message.content, toolCalls };
  };
}
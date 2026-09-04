import { logger } from "../utils/logger.js";
import { agentTools } from "./tools.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import type {
  AgentAnswer,
  AgentStep,
  ChatFn,
  ChartSpec,
  ChatMessage,
  ToolResult,
} from "../types/index.js";

/**
 * Hard stop. A model that keeps calling tools without concluding would
 * otherwise loop until your free tier runs out.
 */
const DEFAULT_MAX_STEPS = 8;

function findTool(name: string) {
  return agentTools.find((tool) => tool.name === name);
}

/** Model output is text, so a malformed arguments string is a normal case. */
function parseArguments(json: string): unknown {
  if (json.trim() === "") {
    return {};
  }

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function describeResult(result: ToolResult): string {
  return result.ok ? "ok" : result.error;
}

export async function askAgent(
  chat: ChatFn,
  question: string,
  maxSteps: number = DEFAULT_MAX_STEPS
): Promise<AgentAnswer> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question },
  ];

  const steps: AgentStep[] = [];
  const charts: ChartSpec[] = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const turn = await chat(messages);

    // No tool calls means the model is answering. That ends the loop.
    if (turn.toolCalls.length === 0) {
      return {
        question,
        answer: turn.text ?? "The model returned no answer.",
        charts,
        steps,
        truncated: false,
      };
    }

    messages.push({
      role: "assistant",
      content: turn.text,
      toolCalls: turn.toolCalls,
    });

    for (const call of turn.toolCalls) {
      const tool = findTool(call.name);

      let result: ToolResult;

      if (tool === undefined) {
        result = { ok: false, error: `no tool named '${call.name}'` };
      } else {
        const args = parseArguments(call.argumentsJson);

        if (args === null) {
          result = { ok: false, error: "arguments were not valid JSON" };
        } else {
          try {
            result = await tool.run(args);
          } catch (error: unknown) {
            // A thrown tool must not take the request down. The model is told
            // what failed and can try something else.
            logger.error(`Tool ${call.name} threw`, error);
            result = { ok: false, error: "the tool failed unexpectedly" };
          }
        }
      }

      if (result.ok && result.chart !== undefined) {
        charts.push(result.chart);
      }

      steps.push({
        tool: call.name,
        arguments: call.argumentsJson,
        ok: result.ok,
        summary: describeResult(result),
      });

      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(result.ok ? result.data : { error: result.error }),
      });
    }
  }

  return {
    question,
    answer:
      "I could not finish within the allowed number of steps. Try a narrower question.",
    charts,
    steps,
    truncated: true,
  };
}
import type { DeviceId } from "./device.js";

// ---------------------------------------------------------------- chat

/** One tool the model asked us to run. */
export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string from the model. Not yet trusted, not yet parsed. */
  argumentsJson: string;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

/** What one turn from the model contains. */
export interface AssistantTurn {
  text: string | null;
  toolCalls: ToolCall[];
}

/**
 * How the agent talks to a model, without knowing which provider it is.
 * Same idea as PublishFn: the capability, not the implementation.
 */
export type ChatFn = (messages: ChatMessage[]) => Promise<AssistantTurn>;

// ---------------------------------------------------------------- tools

export type ToolResult =
  | { ok: true; data: unknown; chart?: ChartSpec }
  | { ok: false; error: string };

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema. Sent to the model so it knows what arguments to supply. */
  parameters: Record<string, unknown>;
  /** Arguments arrive as unknown, because a model is an untrusted source. */
  run: (args: unknown) => Promise<ToolResult>;
}

// ---------------------------------------------------------------- charts

export interface ChartSeries {
  key: string;
  label: string;
}

/**
 * A description of a chart, not a picture of one. The dashboard renders it.
 */
export interface ChartSpec {
  title: string;
  type: "line" | "bar";
  xKey: string;
  series: ChartSeries[];
  data: Record<string, string | number>[];
}

// ---------------------------------------------------------------- answer

/** One thing the agent did, kept so the user can see the working. */
export interface AgentStep {
  tool: string;
  arguments: string;
  ok: boolean;
  summary: string;
}

export interface AgentAnswer {
  question: string;
  answer: string;
  charts: ChartSpec[];
  steps: AgentStep[];
  truncated: boolean;
}

// ---------------------------------------------------------------- forecast

export interface Forecast {
  deviceId: DeviceId;
  metric: "temperature" | "humidity";
  currentValue: number;
  predictedValue: number;
  horizonMinutes: number;
  changePerHour: number;
  rSquared: number;
  sampleCount: number;
}
import { findRecentReadingsByDevice } from "../database/telemetry-repository.js";
import { getAllHealth } from "../services/device-health.js";
import { getLatest } from "../services/telemetry-store.js";
import { describeCoverage } from "./coverage.js";
import { deriveMetrics } from "./derived.js";
import { forecastMetric } from "./forecast.js";
import type { AgentTool, TelemetryRecord, ToolResult } from "../types/index.js";

const MAX_READINGS = 500;

// ------------------------------------------------------- argument parsing
// Arguments come from a language model, which is an outside source. Same
// treatment as an MQTT payload or a request body.

function asObject(args: unknown): Record<string, unknown> | null {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return null;
  }
  return args as Record<string, unknown>;
}

function readString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readNumber(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readMetric(args: Record<string, unknown>): "temperature" | "humidity" {
  return args["metric"] === "humidity" ? "humidity" : "temperature";
}

function clampLimit(value: number): number {
  return Math.min(MAX_READINGS, Math.max(1, Math.floor(value)));
}

// --------------------------------------------------------------- helpers

function summarise(readings: readonly TelemetryRecord[]) {
  return readings.map((reading) => ({
    temperature: reading.temperature,
    humidity: reading.humidity,
    receivedAt: reading.receivedAt.toISOString(),
  }));
}

// ----------------------------------------------------------------- tools

const listDevices: AgentTool = {
  name: "list_devices",
  description:
    "List every device the server has heard from, with its online status and " +
    "most recent reading. Call this first when the user does not name a device.",
  parameters: { type: "object", properties: {}, required: [] },
  run: async (): Promise<ToolResult> => {
    const devices = getAllHealth().map((health) => {
      const latest = getLatest(health.deviceId);

      return {
        deviceId: health.deviceId,
        status: health.status,
        lastSeenAt: health.lastSeenAt.toISOString(),
        latest:
          latest === null
            ? null
            : {
                temperature: latest.temperature,
                humidity: latest.humidity,
                receivedAt: latest.receivedAt.toISOString(),
              },
      };
    });

    return { ok: true, data: { devices, count: devices.length } };
  },
};

const getReadings: AgentTool = {
  name: "get_readings",
  description:
    "Fetch stored readings for one device, newest first. Use a small limit " +
    "unless you need the detail; 50 is usually enough to see a trend.",
  parameters: {
    type: "object",
    properties: {
      deviceId: { type: "string", description: "Exact device id" },
      limit: {
        type: "number",
        description: `How many readings, 1 to ${MAX_READINGS}. Defaults to 50.`,
      },
    },
    required: ["deviceId"],
  },
  run: async (args: unknown): Promise<ToolResult> => {
    const object = asObject(args);
    if (object === null) {
      return { ok: false, error: "arguments must be an object" };
    }

    const deviceId = readString(object, "deviceId");
    if (deviceId === null) {
      return {
        ok: false,
        error: "'deviceId' is required and must be a string",
      };
    }

    const limit = clampLimit(readNumber(object, "limit", 50));
    const readings = await findRecentReadingsByDevice(deviceId, limit);

    if (readings.length === 0) {
      return {
        ok: false,
        error: `no stored readings for device '${deviceId}'. Call list_devices to see valid ids.`,
      };
    }

    return {
      ok: true,
      data: {
        deviceId,
        count: readings.length,
        coverage: describeCoverage(readings),
        readings: summarise(readings),
      },
    };
  },
};

const getStatistics: AgentTool = {
  name: "get_statistics",
  description:
    "Minimum, maximum, mean and standard deviation for a device over its most " +
    "recent readings. Prefer this over fetching raw readings when the user " +
    "asks about typical values, ranges or variability.",
  parameters: {
    type: "object",
    properties: {
      deviceId: { type: "string" },
      limit: {
        type: "number",
        description: "How many recent readings to cover",
      },
    },
    required: ["deviceId"],
  },
  run: async (args: unknown): Promise<ToolResult> => {
    const object = asObject(args);
    if (object === null) {
      return { ok: false, error: "arguments must be an object" };
    }

    const deviceId = readString(object, "deviceId");
    if (deviceId === null) {
      return {
        ok: false,
        error: "'deviceId' is required and must be a string",
      };
    }

    const limit = clampLimit(readNumber(object, "limit", 200));
    const readings = await findRecentReadingsByDevice(deviceId, limit);

    if (readings.length === 0) {
      return {
        ok: false,
        error: `no stored readings for device '${deviceId}'`,
      };
    }

    const describe = (values: number[]) => {
      const mean = values.reduce((total, v) => total + v, 0) / values.length;
      const variance =
        values.reduce((total, v) => total + (v - mean) ** 2, 0) / values.length;

      return {
        min: Number(Math.min(...values).toFixed(2)),
        max: Number(Math.max(...values).toFixed(2)),
        mean: Number(mean.toFixed(2)),
        stdDev: Number(Math.sqrt(variance).toFixed(3)),
      };
    };

    const oldest = readings[readings.length - 1];
    const newest = readings[0];

    return {
      ok: true,
      data: {
        deviceId,
        sampleCount: readings.length,
        from: oldest?.receivedAt.toISOString() ?? null,
        to: newest?.receivedAt.toISOString() ?? null,
        coverage: describeCoverage(readings),
        temperature: describe(readings.map((r) => r.temperature)),
        humidity: describe(readings.map((r) => r.humidity)),
      },
    };
  },
};

const forecast: AgentTool = {
  name: "forecast",
  description:
    "Fit a straight line through recent readings and extend it forwards. " +
    "Returns the predicted value, the rate of change per hour, and an rSquared " +
    "between 0 and 1 describing how well a straight line fits. Below about 0.5 " +
    "the trend is weak and you must say so.",
  parameters: {
    type: "object",
    properties: {
      deviceId: { type: "string" },
      metric: { type: "string", enum: ["temperature", "humidity"] },
      horizonMinutes: {
        type: "number",
        description: "How far ahead to predict. Defaults to 30.",
      },
    },
    required: ["deviceId", "metric"],
  },
  run: async (args: unknown): Promise<ToolResult> => {
    const object = asObject(args);
    if (object === null) {
      return { ok: false, error: "arguments must be an object" };
    }

    const deviceId = readString(object, "deviceId");
    if (deviceId === null) {
      return {
        ok: false,
        error: "'deviceId' is required and must be a string",
      };
    }

    const horizonMinutes = Math.min(
      1440,
      Math.max(1, readNumber(object, "horizonMinutes", 30)),
    );

    const readings = await findRecentReadingsByDevice(deviceId, 200);
    const result = forecastMetric(readings, readMetric(object), horizonMinutes);

    if (result === null) {
      return {
        ok: false,
        error:
          "not enough readings to fit a trend. At least 3 readings spread over " +
          "time are required.",
      };
    }

    return {
      ok: true,
      data: { ...result, coverage: describeCoverage(readings) },
    };
  },
};

const makeChart: AgentTool = {
  name: "make_chart",
  description:
    "Build a chart of a device's readings for the user to look at. Returns a " +
    "confirmation, not an image; the dashboard draws it. Use this whenever the " +
    "user asks to see, plot, graph or visualise something.",
  parameters: {
    type: "object",
    properties: {
      deviceId: { type: "string" },
      title: { type: "string", description: "Short title for the chart" },
      metric: {
        type: "string",
        enum: ["temperature", "humidity", "both"],
        description: "Which series to plot. Defaults to both.",
      },
      limit: {
        type: "number",
        description: "How many recent readings to plot",
      },
    },
    required: ["deviceId", "title"],
  },
  run: async (args: unknown): Promise<ToolResult> => {
    const object = asObject(args);
    if (object === null) {
      return { ok: false, error: "arguments must be an object" };
    }

    const deviceId = readString(object, "deviceId");
    if (deviceId === null) {
      return {
        ok: false,
        error: "'deviceId' is required and must be a string",
      };
    }

    const title = readString(object, "title") ?? `Readings from ${deviceId}`;
    const metric = object["metric"];
    const limit = clampLimit(readNumber(object, "limit", 100));

    const readings = await findRecentReadingsByDevice(deviceId, limit);

    if (readings.length === 0) {
      return {
        ok: false,
        error: `no stored readings for device '${deviceId}'`,
      };
    }

    const series = [];
    if (metric !== "humidity") {
      series.push({ key: "temperature", label: "Temperature (C)" });
    }
    if (metric !== "temperature") {
      series.push({ key: "humidity", label: "Humidity (%)" });
    }

    // Oldest first, so the chart reads left to right.
    const data = [...readings].reverse().map((reading) => ({
      // Epoch milliseconds, so the chart can use a real time axis. An ISO
      // string would give evenly spaced points and hide every gap.
      t: reading.receivedAt.getTime(),
      time: reading.receivedAt.toISOString(),
      temperature: reading.temperature,
      humidity: reading.humidity,
    }));

    const coverage = describeCoverage(readings);

    // The chart itself goes to the user, not into the conversation. Without
    // these figures the model would be describing a picture it cannot see.
    const shapeOf = (values: number[]) => {
      const firstValue = values[0];
      const lastValue = values[values.length - 1];

      if (firstValue === undefined || lastValue === undefined) {
        return null;
      }

      const mean = values.reduce((total, v) => total + v, 0) / values.length;

      return {
        first: firstValue,
        last: lastValue,
        min: Number(Math.min(...values).toFixed(2)),
        max: Number(Math.max(...values).toFixed(2)),
        mean: Number(mean.toFixed(2)),
        netChange: Number((lastValue - firstValue).toFixed(2)),
      };
    };

    const plotted: Record<string, unknown> = {};

    for (const line of series) {
      plotted[line.key] = shapeOf(
        data.map((point) =>
          Number(point[line.key as "temperature" | "humidity"]),
        ),
      );
    }

    return {
      ok: true,
      data: {
        created: true,
        pointCount: data.length,
        coverage,
        plotted,
        note:
          "The chart is shown to the user; you cannot see it. Describe it using " +
          "the figures in 'plotted' only. Do not characterise the shape of the " +
          "line beyond what those numbers support.",
      },
      chart: { title, type: "line", xKey: "t", series, data },
    };
  },
};

const getGrowingConditions: AgentTool = {
  name: "get_growing_conditions",
  description:
    "Compute vapour pressure deficit and dew point from a device's latest " +
    "reading. Use this for questions about plants, greenhouses, crops, " +
    "condensation, mould or drying. These are derived by physics from " +
    "temperature and humidity, not measured directly.",
  parameters: {
    type: "object",
    properties: { deviceId: { type: "string" } },
    required: ["deviceId"],
  },
  run: async (args: unknown): Promise<ToolResult> => {
    const object = asObject(args);
    if (object === null) {
      return { ok: false, error: "arguments must be an object" };
    }

    const deviceId = readString(object, "deviceId");
    if (deviceId === null) {
      return {
        ok: false,
        error: "'deviceId' is required and must be a string",
      };
    }

    const latest = getLatest(deviceId);

    if (latest === null) {
      return { ok: false, error: `no reading stored for device '${deviceId}'` };
    }

    return {
      ok: true,
      data: {
        deviceId,
        measuredAt: latest.receivedAt.toISOString(),
        ...deriveMetrics(latest),
      },
    };
  },
};

export const agentTools: AgentTool[] = [
  listDevices,
  getReadings,
  getStatistics,
  forecast,
  getGrowingConditions,
  makeChart,
];

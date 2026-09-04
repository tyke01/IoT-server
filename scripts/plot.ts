/**
 * Plots readings without a dashboard, a build step, or any new dependency.
 *
 *   npm run plot                    ASCII in the terminal
 *   npm run plot -- --html          also writes chart.html
 *   npm run plot -- --device esp32-01 --limit 200 --metric humidity
 *
 * Reads through the running server's API, so it exercises the same path the
 * dashboard will.
 */
import { writeFileSync } from "node:fs";

import { config } from "../src/config/env.js";
import { logger } from "../src/utils/logger.js";
import type { TelemetryResponse } from "../src/types/index.js";

const CHART_HEIGHT = 16;
const CHART_WIDTH = 72;

interface Options {
  device: string | null;
  limit: number;
  metric: "temperature" | "humidity";
  html: boolean;
}

function parseArgs(argv: string[]): Options {
  const read = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : (argv[index + 1] ?? null);
  };

  const limitRaw = read("--limit");
  const metricRaw = read("--metric");

  return {
    device: read("--device"),
    limit: limitRaw === null ? 100 : Number(limitRaw),
    metric: metricRaw === "humidity" ? "humidity" : "temperature",
    html: argv.includes("--html"),
  };
}

const baseUrl = `http://localhost:${config.http.port}`;

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`);

  if (!response.ok) {
    throw new Error(`GET ${path} returned ${response.status}`);
  }

  return response.json();
}

async function pickDevice(explicit: string | null): Promise<string> {
  if (explicit !== null) {
    return explicit;
  }

  const devices = (await fetchJson("/api/devices")) as { deviceId: string }[];
  const first = devices[0];

  if (first === undefined) {
    throw new Error("No devices known. Start the server and the mock first.");
  }

  return first.deviceId;
}

/**
 * A column-per-reading plot. Not pretty, but it appears instantly and works
 * over SSH, which is more than a dashboard can say.
 */
function asciiPlot(values: number[], label: string): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  // One column per reading, dropping the oldest if there are too many.
  const columns = values.slice(-CHART_WIDTH);

  // A 1 degree range across 16 rows is 0.06 per row, so one decimal would
  // print the same label twice.
  const decimals = span < 5 ? 2 : 1;

  const rows: string[] = [];

  for (let row = CHART_HEIGHT - 1; row >= 0; row -= 1) {
    const rowValue = min + (span * row) / (CHART_HEIGHT - 1);
    const axis = rowValue.toFixed(decimals).padStart(6);

    let line = "";

    for (const value of columns) {
      const valueRow = Math.round(((value - min) / span) * (CHART_HEIGHT - 1));
      line += valueRow === row ? "*" : " ";
    }

    rows.push(`${axis} |${line}`);
  }

  rows.push(`${" ".repeat(6)} +${"-".repeat(columns.length)}`);
  rows.push(
    `${" ".repeat(8)}${label}, ${columns.length} readings, ` +
      `min ${min.toFixed(1)} max ${max.toFixed(1)}`,
  );

  return rows.join("\n");
}

function buildHtml(readings: TelemetryResponse[], deviceId: string): string {
  const points = readings.map((reading) => ({
    x: new Date(reading.receivedAt).getTime(),
    temperature: reading.temperature,
    humidity: reading.humidity,
  }));

  // Chart.js from a CDN, so this file needs no build and no node_modules.
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${deviceId} readings</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3"></script>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; background: #0f1720; color: #d7e3ee; }
    h1 { font-size: 1.1rem; font-weight: 600; }
    .wrap { max-width: 60rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${deviceId} &mdash; ${points.length} readings</h1>
    <canvas id="chart"></canvas>
  </div>
  <script>
    const points = ${JSON.stringify(points)};
    new Chart(document.getElementById("chart"), {
      type: "line",
      data: {
        datasets: [
          { label: "Temperature (C)", data: points.map(p => ({ x: p.x, y: p.temperature })),
            borderColor: "#4cc9f0", yAxisID: "y", pointRadius: 0, tension: 0.2 },
          { label: "Humidity (%)", data: points.map(p => ({ x: p.x, y: p.humidity })),
            borderColor: "#f4a261", yAxisID: "y1", pointRadius: 0, tension: 0.2 }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        scales: {
          // A real time axis. Gaps in the data show as gaps in the line.
          x: { type: "time", ticks: { color: "#8fa3b8" }, grid: { color: "#1e2a36" } },
          y: { position: "left", title: { display: true, text: "C" },
               ticks: { color: "#8fa3b8" }, grid: { color: "#1e2a36" } },
          y1: { position: "right", title: { display: true, text: "%" },
                ticks: { color: "#8fa3b8" }, grid: { drawOnChartArea: false } }
        },
        plugins: { legend: { labels: { color: "#d7e3ee" } } }
      }
    });
  </script>
</body>
</html>`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const deviceId = await pickDevice(options.device);

  const readings = (await fetchJson(
    `/api/telemetry/history/${deviceId}?limit=${options.limit}`,
  )) as TelemetryResponse[];

  if (readings.length === 0) {
    logger.warn(`No stored readings for ${deviceId}.`);
    return;
  }

  // The API returns newest first. Charts read left to right.
  const ordered = [...readings].reverse();
  const values = ordered.map((r) =>
    options.metric === "temperature" ? r.temperature : r.humidity,
  );

  console.log();
  console.log(asciiPlot(values, `${deviceId} ${options.metric}`));
  console.log();

  if (options.html) {
    const path = "chart.html";
    writeFileSync(path, buildHtml(ordered, deviceId), "utf8");
    logger.info(`Wrote ${path}. Open it in a browser.`);
  }
}

main().catch((error: unknown) => {
  logger.error("Plot failed", error);
  logger.error(`Is the server running on ${baseUrl}?`);
  process.exit(1);
});

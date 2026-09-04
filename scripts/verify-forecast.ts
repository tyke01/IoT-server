import { forecastMetric } from "../src/agent/forecast.js";
import type { TelemetryRecord } from "../src/types/index.js";

function make(values: number[], stepMs = 3000): TelemetryRecord[] {
  const start = Date.UTC(2026, 8, 4, 12, 0, 0);
  // newest first, as the repository returns them
  return values
    .map((v, i) => ({
      deviceId: "esp32-01",
      temperature: v,
      humidity: 60,
      receivedAt: new Date(start + i * stepMs),
    }))
    .reverse();
}

// Perfect line: +0.5C every 3s = +600C/hour. 30 min ahead from 27.0 -> 327.0
const perfect = forecastMetric(make([24, 24.5, 25, 25.5, 26, 26.5, 27]), "temperature", 30);
console.log("perfect line:", perfect);

// Flat
const flat = forecastMetric(make([24, 24, 24, 24, 24]), "temperature", 30);
console.log("flat:", flat);

// Noisy, no real trend
const noisy = forecastMetric(make([24, 26, 23, 27, 22, 25, 24]), "temperature", 30);
console.log("noisy rSquared:", noisy?.rSquared, "predicted:", noisy?.predictedValue);

// Too few
console.log("two readings:", forecastMetric(make([24, 25]), "temperature", 30));

// All at the same instant
console.log("zero variance in x:", forecastMetric(make([24, 25, 26], 0), "temperature", 30));
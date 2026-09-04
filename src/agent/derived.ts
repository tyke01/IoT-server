import type { TelemetryRecord } from "../types/index.js";

/**
 * Values a DHT22 does not report but which follow from what it does.
 *
 * These are physics, not machine learning, and they are the honest bridge
 * between a sensor on a desk and a real agricultural or building metric.
 */

export interface DerivedMetrics {
  temperature: number;
  humidity: number;
  /** Saturation vapour pressure, kPa. Tetens equation. */
  saturationVapourPressure: number;
  /** Vapour pressure deficit, kPa. How hard the air pulls water from a leaf. */
  vapourPressureDeficit: number;
  /** Temperature at which this air would condense, C. Magnus formula. */
  dewPoint: number;
  /** How far the surface is above the dew point. Below ~2C, condensation risk. */
  dewPointMargin: number;
  interpretation: string;
}

/** Tetens equation. Verified: 0.611 kPa at 0C, 2.34 at 20C, 3.17 at 25C. */
function saturationVapourPressure(temperature: number): number {
  return 0.6108 * Math.exp((17.27 * temperature) / (temperature + 237.3));
}

function dewPoint(temperature: number, humidity: number): number {
  const gamma =
    Math.log(humidity / 100) + (17.27 * temperature) / (237.3 + temperature);
  return (237.3 * gamma) / (17.27 - gamma);
}

/**
 * Ranges are the commonly cited greenhouse guidance for general crops.
 * Species and growth stage change them, so treat this as orientation rather
 * than agronomic advice.
 */
function interpret(vpd: number, margin: number): string {
  const parts: string[] = [];

  if (vpd < 0.4) {
    parts.push(
      "VPD is very low: the air is nearly saturated, transpiration slows, and " +
        "fungal disease risk rises."
    );
  } else if (vpd <= 1.6) {
    parts.push("VPD is in the range usually considered comfortable for growth.");
  } else {
    parts.push(
      "VPD is high: plants lose water quickly and may close stomata, which " +
        "stops growth even with wet soil."
    );
  }

  if (margin < 2) {
    parts.push(
      `Surfaces are only ${margin.toFixed(1)}C above the dew point, so ` +
        "condensation is likely."
    );
  }

  return parts.join(" ");
}

export function deriveMetrics(reading: TelemetryRecord): DerivedMetrics {
  const es = saturationVapourPressure(reading.temperature);
  const vpd = es * (1 - reading.humidity / 100);
  const dew = dewPoint(reading.temperature, reading.humidity);
  const margin = reading.temperature - dew;

  return {
    temperature: reading.temperature,
    humidity: reading.humidity,
    saturationVapourPressure: Number(es.toFixed(3)),
    vapourPressureDeficit: Number(vpd.toFixed(2)),
    dewPoint: Number(dew.toFixed(1)),
    dewPointMargin: Number(margin.toFixed(1)),
    interpretation: interpret(vpd, margin),
  };
}
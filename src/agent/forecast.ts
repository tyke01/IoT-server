import type { Forecast, TelemetryRecord } from "../types/index.js";

/**
 * Least squares fit of value against time, extended forwards.
 *
 * This is arithmetic, not a model. The agent calls it; the agent does not
 * produce the number itself. See the README for why that distinction is the
 * whole point of this file.
 */
export function forecastMetric(
  readings: readonly TelemetryRecord[],
  metric: "temperature" | "humidity",
  horizonMinutes: number
): Forecast | null {
  if (readings.length < 3) {
    return null;
  }

  // Oldest first, so time increases with index.
  const ordered = [...readings].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
  );

  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  if (first === undefined || last === undefined) {
    return null;
  }

  const originMs = first.receivedAt.getTime();

  // x in hours since the first reading, y is the metric.
  const points = ordered.map((reading) => ({
    x: (reading.receivedAt.getTime() - originMs) / 3_600_000,
    y: metric === "temperature" ? reading.temperature : reading.humidity,
  }));

  const n = points.length;
  const sumX = points.reduce((total, p) => total + p.x, 0);
  const sumY = points.reduce((total, p) => total + p.y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;

  let covariance = 0;
  let varianceX = 0;

  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY);
    varianceX += (point.x - meanX) ** 2;
  }

  // All readings at the same instant. No slope is definable.
  if (varianceX === 0) {
    return null;
  }

  const slope = covariance / varianceX;
  const intercept = meanY - slope * meanX;

  let residualSum = 0;
  let totalSum = 0;

  for (const point of points) {
    const predicted = intercept + slope * point.x;
    residualSum += (point.y - predicted) ** 2;
    totalSum += (point.y - meanY) ** 2;
  }

  // A perfectly flat line explains all of zero variance.
  const rSquared = totalSum === 0 ? 1 : 1 - residualSum / totalSum;

  const lastX = (last.receivedAt.getTime() - originMs) / 3_600_000;
  const futureX = lastX + horizonMinutes / 60;

  return {
    deviceId: last.deviceId,
    metric,
    currentValue: metric === "temperature" ? last.temperature : last.humidity,
    predictedValue: Number((intercept + slope * futureX).toFixed(2)),
    horizonMinutes,
    changePerHour: Number(slope.toFixed(3)),
    rSquared: Number(rSquared.toFixed(3)),
    sampleCount: n,
  };
}
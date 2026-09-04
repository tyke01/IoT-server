import type { TelemetryRecord } from "../types/index.js";

/**
 * A gap larger than this is a server outage, not a sampling interval.
 * Readings arrive every few seconds, so a minute of silence is a gap.
 */
const GAP_THRESHOLD_MS = 60_000;

export interface Coverage {
  /** Wall-clock time from the oldest reading to the newest. */
  spanMinutes: number;
  /** Time actually covered by readings, gaps excluded. */
  sampledMinutes: number;
  gapCount: number;
  largestGapMinutes: number;
  contiguous: boolean;
  note: string;
}

/**
 * Readings are counted, not time-ranged, so "the last 50" can span days if the
 * server was off. Every tool reports this so the agent can say so.
 */
export function describeCoverage(readings: readonly TelemetryRecord[]): Coverage {
  const ordered = [...readings].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
  );

  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  if (first === undefined || last === undefined || ordered.length < 2) {
    return {
      spanMinutes: 0,
      sampledMinutes: 0,
      gapCount: 0,
      largestGapMinutes: 0,
      contiguous: true,
      note: "too few readings to assess coverage",
    };
  }

  const spanMs = last.receivedAt.getTime() - first.receivedAt.getTime();

  let gapMs = 0;
  let gapCount = 0;
  let largestGapMs = 0;

  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];

    if (previous === undefined || current === undefined) {
      continue;
    }

    const delta = current.receivedAt.getTime() - previous.receivedAt.getTime();

    if (delta > GAP_THRESHOLD_MS) {
      gapMs += delta;
      gapCount += 1;
      largestGapMs = Math.max(largestGapMs, delta);
    }
  }

  const toMinutes = (ms: number): number => Number((ms / 60_000).toFixed(1));
  const contiguous = gapCount === 0;

  const note = contiguous
    ? "Readings are continuous. Trends over this window are meaningful."
    : `These readings are NOT continuous: ${gapCount} gap(s), the largest ` +
      `${toMinutes(largestGapMs)} minutes. Only ${toMinutes(spanMs - gapMs)} of the ` +
      `${toMinutes(spanMs)} minute span contains data. Say so, and treat any trend ` +
      `across the gaps as unreliable.`;

  return {
    spanMinutes: toMinutes(spanMs),
    sampledMinutes: toMinutes(spanMs - gapMs),
    gapCount,
    largestGapMinutes: toMinutes(largestGapMs),
    contiguous,
    note,
  };
}
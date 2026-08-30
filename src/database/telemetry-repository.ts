import { db } from "../prisma/db.ts";
import type { DeviceId, TelemetryRecord } from "../types/index.ts";
import { fromTimestamptz, toTimestamptz } from "./timestamps.ts";

/** The shape Prisma hands back. It has an id; a TelemetryRecord does not. */
interface ReadingRow {
  id: number;
  deviceId: string;
  temperature: number;
  humidity: number;
  receivedAt: string;
}

function toTelemetryRecord(row: ReadingRow): TelemetryRecord {
  return {
    deviceId: row.deviceId,
    temperature: row.temperature,
    humidity: row.humidity,
    receivedAt: fromTimestamptz(row.receivedAt),
  };
}

export async function saveReading(record: TelemetryRecord): Promise<void> {
  await db.orm.public.Reading.create({
    deviceId: record.deviceId,
    temperature: record.temperature,
    humidity: record.humidity,
    receivedAt: toTimestamptz(record.receivedAt),
  });
}

export async function findRecentReadings(limit: number): Promise<TelemetryRecord[]> {
  const rows = await db.orm.public.Reading
    .orderBy((r) => r.receivedAt.desc())
    .limit(limit)
    .all();

  return rows.map(toTelemetryRecord);
}

export async function findRecentReadingsByDevice(
  deviceId: DeviceId,
  limit: number
): Promise<TelemetryRecord[]> {
  const rows = await db.orm.public.Reading
    .where({ deviceId })
    .orderBy((r) => r.receivedAt.desc())
    .limit(limit)
    .all();

  return rows.map(toTelemetryRecord);
}
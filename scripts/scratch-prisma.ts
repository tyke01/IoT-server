import type { TimestamptzString } from "@prisma/orm-postgres/target/codec-types";
import { db } from "../src/prisma/db.js";

function toTimestamptz(date: Date): TimestamptzString<3> {
  return date.toISOString() as TimestamptzString<3>;
}

const created = await db.orm.public.Reading.create({
  deviceId: "esp32-01",
  temperature: 24.1,
  humidity: 59.2,
  receivedAt: toTimestamptz(new Date()),
});

console.log("created:", created);

const rows = await db.orm.public.Reading.limit(3)
  .orderBy((r) => r.receivedAt.desc())
  .all();

console.log("found:", rows);
console.log("receivedAt is a", typeof rows[0]?.receivedAt, rows[0]?.receivedAt);
console.log(new Date("2026-08-30 11:03:44.446+00").toISOString());

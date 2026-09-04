import type { TimestamptzString } from "@prisma/orm-target-postgres/target/codec-types";

/**
 * The precision declared on Reading.receivedAt in the contract. Changing one
 * without the other is a compile error, which is the point.
 */
type Precision = 3;

/**
 * Prisma's TimestamptzString is a string carrying a phantom property that
 * cannot exist at runtime, and the package exports no constructor for one.
 * This assertion is the only place in the project that lies to the compiler,
 * and it is safe because the value really is a string in a format Postgres
 * accepts. See the README.
 */
export function toTimestamptz(date: Date): TimestamptzString<Precision> {
  return date.toISOString() as TimestamptzString<Precision>;
}

/** Postgres returns "2026-08-30 11:26:40.868+00", which is not ISO 8601. */
export function fromTimestamptz(value: string): Date {
  return new Date(value);
}
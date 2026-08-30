# `src/database/`

## Responsibility

Everything this project writes about talking to Postgres. Turn a `TelemetryRecord`
into a row, turn rows back into `TelemetryRecord`s, and hold the two conversions the
database forces on us.

## Must never

- Be imported by `src/api/`. A route asks a service, a service asks this folder. When
  step 8's history endpoint calls the repository directly, that is a deliberate
  shortcut, discussed below, and not the pattern to copy.
- Let a database type escape. Nothing outside this folder should know that a row has
  an `id`, or that a timestamp arrives as a string.

## Files

| File | What it does |
|---|---|
| `telemetry-repository.ts` | Save a reading, read recent readings back |
| `timestamps.ts` | Convert between `Date` and Prisma's timestamp representation |

## Two folders, one database

`src/prisma/` is **generated**. `contract.prisma` is yours to edit, but
`contract.json`, `contract.d.ts`, and `db.ts` are produced by `prisma contract emit`
and carry a do-not-edit notice. Commit them anyway: they are how every machine and
every teammate agrees on what the database looks like.

`src/database/` is **ours**. It is the only place that imports `db`, so the rest of
the project never touches Prisma's API directly.

That separation is worth the extra folder. When Prisma 8 leaves release candidate and
its API shifts again, two files change. Had `db.orm.public.Reading` been sprinkled
through the routes and services, the whole project would move.

---

## The boundary, for the fourth time

Steps 3, 4 and 6 each argued that data crossing a boundary gets its own type, and
each time the two types looked nearly identical, which slightly weakened the case.

Here they genuinely differ:

```ts
interface ReadingRow {          interface TelemetryRecord {
  id: number;                     // no id
  deviceId: string;               deviceId: DeviceId;
  temperature: number;            temperature: number;
  humidity: number;               humidity: number;
  receivedAt: string;             receivedAt: Date;
}                               }
```

Two real differences, and neither is optional.

**The `id` is the database's business.** It exists because rows need identity in a
table. It means nothing to the MQTT handler or the dashboard. If `TelemetryRecord`
carried it, every part of the program would need an answer for what `id` is on a
reading that has not been saved yet.

**The timestamp is a string.** Not a choice we made. See below.

`toTelemetryRecord` is where the two meet, and it is nine lines. That is the whole
cost of the separation.

---

## `timestamps.ts`, and the one assertion in this project

Prisma 8 made a deliberate change: PostgreSQL temporal columns read as Temporal
values or as text, never as a JavaScript `Date`. The bare PSL spelling `Timestamptz`
selects a `Temporal.Instant`, which requires a global `Temporal` implementation that
Node does not yet provide. Our contract therefore declares:

```prisma
receivedAt  TimestamptzString(3)
```

The column in Postgres is still a real `timestamptz`, so ordering and range filters
still happen correctly in SQL. Only the JavaScript representation is text.

### The write side

`TimestamptzString<3>` is defined in `@prisma/orm-target-postgres` as:

```ts
type Branded<T, Shape> = T & { readonly [K in keyof Shape]: Shape[K] };
type TimestamptzString<P> = Branded<string, { __timestamptzStringPrecision: P }>;
```

So it is `string & { readonly __timestamptzStringPrecision: 3 }`: a string carrying a
property no string can have. The property is a **phantom**, present in the type system
and absent at runtime. Its purpose is nominal typing. TypeScript normally treats all
strings as interchangeable, and the brand makes this one distinct, so a `deviceId`
cannot be passed where a timestamp belongs.

This is exactly the branded-types technique listed in the improvements track for
`DeviceId`, where the note says it costs something. Here is the cost: the package
exports no constructor, so the only way to produce one is an assertion.

```ts
export function toTimestamptz(date: Date): TimestamptzString<Precision> {
  return date.toISOString() as TimestamptzString<Precision>;
}
```

`src/devices/README.md` says never to write `as`, and calls
`JSON.parse(payload) as Dht22Reading` a lie to the compiler. That still stands. The
difference is what is being asserted.

That one claimed unverified knowledge about bytes from the network. This one adds a
marker that cannot exist at runtime, to a value we can see is a string in a format
Postgres accepts. Nothing is being assumed about data we have not checked.

It is also confined to one three-line function that the rest of the project cannot
bypass, because `saveReading` is the only way in. If the assertion is ever wrong, it
is wrong in one place.

The alternative is the `temporal-polyfill` package with
`import 'temporal-polyfill/full/global'` in the entry point before any query runs.
That removes the assertion and adds an entire unfamiliar date API, plus a failure
mode where putting the import in the wrong place breaks at runtime rather than at
compile time. The improvements track covers it.

### The read side

Postgres hands back its own text format:

```
2026-08-30 11:26:40.868+00
```

A space instead of `T`, and `+00` instead of `Z`. That is not ISO 8601, and the
ECMAScript specification does not require engines to parse non-ISO date strings, so
`new Date(...)` on it is implementation-defined behaviour.

Node parses it correctly, verified across offsets and with milliseconds absent:

| Input | `new Date(...).toISOString()` |
|---|---|
| `2026-08-30 11:26:40.868+00` | `2026-08-30T11:26:40.868Z` |
| `2026-08-30 11:26:40.868+03` | `2026-08-30T08:26:40.868Z` |
| `2026-08-30 11:26:40+00` | `2026-08-30T11:26:40.000Z` |
| `2026-08-30 12:04:38.5+00` | `2026-08-30T12:04:38.500Z` |
| `2026-08-30 12:04:23.46+00` | `2026-08-30T12:04:23.460Z` |

Note the third row: the offset is applied, not ignored. The fourth: a missing
milliseconds component is fine. The last two: Postgres trims trailing zeros, so a
stored value can have one, two or three fractional digits, and `.5` correctly means
500 milliseconds rather than 5.

So `fromTimestamptz` is one line, and this paragraph exists so that nobody later
assumes it was one line because the problem was simple. If you ever run this on a
different JavaScript engine, verify that table again first.

---

## What this folder does not do yet

No index on `receivedAt`. Every history query is a sequential scan, which is
imperceptible at a thousand rows and painful at a million. Indexing is in the
improvements track, on purpose: watching a query get slow teaches more than being
handed an index you never needed.

No `Device` table. `deviceId` is a bare string with nothing enforcing that it refers
to anything real, which is why step 7's command endpoint cannot answer "no such
device".

No connection cleanup on shutdown. The scratch script exits on its own, so the pool
is not holding the process open, but a long-running server should still close it
deliberately. Verify what `db` exposes before adding it.

---

## Changed at

Step 8 (created).
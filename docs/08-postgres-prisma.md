# Step 8: Store readings in Postgres

**Written against:** Prisma `8.0.0-rc.12` (CLI), `@prisma/orm-postgres` `8.0.0-rc.8`,
`@prisma/cli-engine` `0.3.0`, Node 24, PostgreSQL 16.

That line is not boilerplate. Prisma 8 is a release candidate, its published
documentation currently describes a build newer than the one on npm, and two of the
examples on Prisma's own website do not work in the version above. Where this document
and the website disagree, this document was verified by running it. If your versions
differ from these, expect differences.

**Goal:** readings survive a restart, and `GET /api/telemetry/history` answers
questions about the past.

**Files added:** `src/database/telemetry-repository.ts`, `src/database/timestamps.ts`,
`src/api/parse-query.ts`

**Files changed:** `src/prisma/contract.prisma`, `src/services/message-handler.ts`,
`src/mqtt/client.ts`, `src/api/routes/telemetry.ts`, `tsconfig.json`, `package.json`,
`.env.example`

## 1. Prerequisites, revisited

Two requirements changed since step 0 and both are hard failures, not warnings:

- **Node 24 or newer.** Prisma 8 requires it.
- **PostgreSQL 15 or newer.** Check with `SELECT version();`.

Create the database:

```bash
psql -U postgres -c "CREATE USER iot WITH PASSWORD 'iot';"
psql -U postgres -c "CREATE DATABASE iot OWNER iot;"
```

A hosted database such as Neon works identically. Only `DATABASE_URL` changes, and
nothing in the code knows the difference.

## 2. Install and initialise

```bash
npx prisma orm init --target postgres --authoring psl
```

Pin the versions exactly. This matters more than usual on a release candidate,
because a caret range like `^8.0.0-rc.10` will happily install a different RC
tomorrow, and two students would then be running two different libraries:

```bash
npm install --save-dev --save-exact prisma@8.0.0-rc.12
npm install --save-exact @prisma/orm-postgres@8.0.0-rc.8
npm install --save-dev --save-exact @prisma/cli-engine@0.3.0
```

Set `DATABASE_URL` in `.env`.

## 3. The contract

Prisma 8 calls the schema a **contract**, and it lives at
`src/prisma/contract.prisma`. Add:

```prisma
model Reading {
  id          Int                  @id @default(autoincrement())
  deviceId    String
  temperature Float
  humidity    Float
  receivedAt  TimestamptzString(3)

  @@map("readings")
}
```

One flat table. No relations, no indexes. Both are improvements later, and both are
better learned by first feeling their absence.

`TimestamptzString(3)` rather than the obvious `DateTime` is not a stylistic
preference. Section 6 explains why, and it is the most interesting thing in this
step.

```bash
npx prisma contract emit
npx prisma migration plan --name add_readings
npx prisma db migrate --advance-ref db
```

Three commands where Prisma 7 had one. `contract emit` compiles the contract into
`contract.json` and `contract.d.ts`. `migration plan` works out the SQL and shows you
a DDL preview without running anything. `db migrate` applies it.

The separation is the point: you review the SQL before it touches your database.

### If `migration plan` refuses to run

```
✘ [MIGRATION.PLAN_ORIGIN_UNKNOWN] Cannot determine the plan origin
```

Migrations exist on disk but nothing records which one your database is at, so the
planner would have to guess, and guessing wrong means generating a migration that
recreates tables you already have. Point the `db` ref at your current contract hash,
which the error message prints:

```bash
npx prisma migration ref set db <hash>
npx prisma migration status
```

The `--advance-ref db` flag on `db migrate` keeps it current after that, which is why
it is baked into the `db:migrate` script in `package.json`.

## 4. Two folders for one database

`src/prisma/` is generated. `src/database/` is ours, and it is the only place that
imports `db`.

That is not ceremony. Prisma 8 is a release candidate whose API is still moving.
Confining it to two files means the next change touches two files.
[`src/database/README.md`](../src/database/README.md) has the detail.

## 5. Writing on every reading

`saveReading(record)` in `message-handler.ts`, one line after `saveLatest(record)`.

Both stay. Memory answers "what is the temperature right now" in microseconds. The
database answers "what was it at 3am on Tuesday" and cannot answer the first question
as quickly. They are different questions and they deserve different storage.

### The async problem

`handleMessage` had to become `async`, which broke something invisible.

```ts
client.on("message", (topic, payload) => {
  handler(topic, payload.toString());   // returns a promise nobody is holding
});
```

mqtt.js does not await your callback. If the promise rejects, nothing catches it, and
an unhandled rejection takes the process down. One dead database connection would
kill your whole server.

So `onMessage` handles it explicitly:

```ts
void Promise.resolve(handler(topic, payload.toString())).catch((error: unknown) => {
  logger.error("Message handler failed", error);
});
```

Now a failed write is a logged warning and the server keeps running.

**Notice what this does not fix.** Messages keep arriving whether or not Postgres
keeps up. There is no backpressure anywhere in this design: nothing tells the ESP32
to slow down, and nothing queues. With one device every 3 seconds you will never
notice. With two hundred devices every second, writes pile up faster than they
complete and memory grows until the process dies.

That is a real limit of the architecture, not a bug in the code, and knowing where
your design stops working is worth more than a design with no visible limits. Batched
writes are in the improvements track and this is the problem they solve.

## 6. Why the timestamp is a string

The interesting part of this step, and the one that will confuse anyone reading the
contract later.

Prisma 8 changed how PostgreSQL temporal columns are represented. From their own
upgrade notes:

> PostgreSQL temporal columns read as Temporal values or text, never `Date`.

The bare spelling `Timestamptz` selects a codec backed by `Temporal.Instant`, part of
a new JavaScript date API that Node does not yet provide as a global. Use it without a
polyfill and every write fails:

```
Error: Codec 'pg/timestamptz-temporal@1' cannot encode a value because this runtime
has no global Temporal implementation.
  code: 'RUNTIME.TEMPORAL_UNAVAILABLE'
```

`TimestamptzString(3)` selects the text codec instead. The column stays a real
`timestamptz` in Postgres, confirmed in the emitted contract:

```json
"receivedAt": {
  "codecId": "pg/timestamptz-string@1",
  "nativeType": "timestamptz",
  "typeParams": { "precision": 3 }
}
```

So sorting and filtering still happen correctly in SQL. Only the JavaScript side is
text, and `src/database/timestamps.ts` converts at the boundary.

Read that file's section in the database README before you write your own conversion.
It covers the one type assertion in this project, why it is acceptable where the ones
we banned earlier were not, and the verified table showing that Node parses
Postgres's non-ISO output correctly.

## 7. The history endpoints

```
GET /api/telemetry/history?limit=100
GET /api/telemetry/history/:deviceId?limit=100
```

### `limit` is not optional in the query, it is not optional in the code

```ts
const rows = await db.orm.public.Reading
  .orderBy((r) => r.receivedAt.desc())
  .limit(limit)
  .all();
```

`.all()` applies no limit of its own. Leave `.limit()` off and you select every row in
the table. Today that is fifty rows. Leave the server running over a weekend with one
device and it is roughly two hundred thousand.

This is the single easiest way to write a query that works perfectly in class and
falls over in production, and it is worth writing that sentence on the board.

### Prisma's docs say `.take()`

They do, and it does not exist in `@prisma/orm-postgres@8.0.0-rc.8`. Both the compiler
and the runtime agree:

```
Property 'take' does not exist on type 'Collection<...>'
TypeError: db.orm.public.Reading.orderBy(...).take is not a function
```

The method is `.limit(n)`, and paging is `.offset(n)`, not `.skip(n)`. Read from the
package's own type definitions:

```ts
/** Apply `LIMIT n`. Replaces any previous limit set on this collection. */
limit(n: number): Collection<TContract, ModelName, Row, State>;
```

There is a lesson here beyond the method name. **When the documentation and the
installed package disagree, the package wins.** Your editor's autocomplete and the
`.d.mts` files in `node_modules` describe the code you are actually running. A
website describes the code someone intends to ship.

### `.select()` is not `.limit()`

A natural guess, and wrong in a way worth being explicit about:

- `.select("id", "deviceId")` chooses **which columns** come back. SQL `SELECT`.
- `.limit(100)` chooses **how many rows** come back. SQL `LIMIT`.

Select two columns from a million-row table and you still get a million rows.

### Validating the query string

`?limit=abc` is input from outside the program, so it gets the same treatment as an
MQTT payload and a request body: `parseLimit` in `src/api/parse-query.ts`, returning
the same discriminated union shape as the other two parsers.

Missing means 100. Not a whole number means 400. Outside 1 to 1000 means 400. The
upper bound exists because `?limit=99999999` is a denial-of-service request wearing a
polite hat.

## 8. Verify

```bash
npm run dev
npm run mock
```

Let it run for a minute, then:

```bash
curl "http://localhost:3000/api/telemetry/history?limit=3"
curl "http://localhost:3000/api/telemetry/history/esp32-01?limit=3"
curl -i "http://localhost:3000/api/telemetry/history?limit=abc"
curl -i "http://localhost:3000/api/telemetry/history?limit=99999"
```

The last two should be 400 with a message naming the problem.

### Look at the order of the log lines

Run the mock from a cold start and compare what it published against what the server
stored. From a real run:

| Published | Value | Stored |
|---|---|---|
| 12:04:20.174 | 24.1 / 60.4 | 12:04:26.472 |
| 12:04:23.187 | 24.1 / 61.3 | 12:04:**29.913** |
| 12:04:26.204 | 24.3 / 61.5 | 12:04:**30.240** |
| 12:04:29.206 | 24.5 / 61.8 | 12:04:**29.801** |

The fourth reading was stored before the second and third, and the first took over six
seconds.

Neither is a bug, and both follow from section 5. `handleMessage` is `async` and
`onMessage` does not await it, so handlers for messages arriving close together run
concurrently and finish whenever the database finishes with them. The log line comes
after `await saveReading`, so the log shows completion order, not arrival order.

The slow first write is the database connection being established: handshake,
authentication, pool setup. Later writes settle to a few hundred milliseconds.

Two things follow, and the second one bites people later.

**The data is still correct.** `receivedAt` is stamped when the message arrives,
before anything is awaited. That is why the history endpoint returns readings in the
right order despite the rows being written in the wrong one.

**The `id` sequence is not chronological.** The fourth reading has a lower `id` than
the second and third. Any code that assumes autoincrement order matches time order is
wrong on this table, which is worth remembering when you reach cursor pagination.

If you want the writes serialised, that is a queue, and a queue is the batched-writes
improvement. Adding one now would hide the concurrency rather than teach it.

### The test that matters

1. Note the newest reading from `/api/telemetry/history?limit=1`.
2. Stop the server with Ctrl+C.
3. Stop the mock.
4. Start the server again, with no mock running.
5. Call `/api/telemetry/latest`. **Empty.**
6. Call `/api/telemetry/history?limit=1`. **Your reading is still there.**

That is the whole point of this step in two curl calls. The in-memory store was lost,
exactly as step 5 said it would be. The database was not.

You saw this already during testing, when device `001` vanished from `/api/devices`
after a restart. Now you have the half that survives.

## What you now have

Every reading is durable. The API answers questions about the past as well as the
present. The system is complete in the sense that nothing essential is missing.

What remains is making it not embarrassing: validating everything at every boundary
in a consistent way, giving every error the same response shape, and shutting down
cleanly. That is step 9.

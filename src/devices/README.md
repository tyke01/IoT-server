# `src/devices/`

## Responsibility

Everything this server knows about the physical hardware. What a DHT22 payload looks
like, which topic an LED listens on, how to tell a heartbeat from a reading.

This is the folder that changes when the hardware changes, and ideally the only one.

## Must never

- Open a network connection. It builds topic strings and interprets payloads. Sending
  and receiving belongs to `src/mqtt/`.
- Store anything. Handing a parsed reading back to whoever asked for it is the whole
  job. Keeping it is `src/services/`.

## Files

| File | What it does |
|---|---|
| `topics.ts` | Builds topic strings, recognises them, extracts the device id |
| `dht22.ts` | Turns a raw payload string into a reading, or explains why it cannot |
| `led.ts` | Validates an LED command body, builds the payload the firmware expects |

---

## Why this folder exists at all

At step 2, `src/mqtt/client.ts` subscribed to `spectral/esp32/#` and the entry point
logged whatever arrived. Simple, and it worked.

The rule stated in the `src/mqtt/` README was that the MQTT folder must never know
what a DHT22 is. Step 4 is where that rule earns its keep. Parsing needs to know the
payload shape. Routing needs to know that `/sensors/dht` means something different
from `/health`. If that knowledge went into `client.ts`, then adding a BME280 would
mean editing the file that owns your broker connection, and a mistake there takes the
whole server down rather than one sensor.

So: `mqtt/` moves strings. `devices/` decides what the strings mean.

---

## `topics.ts`

### Subscriptions with `+`

```ts
export function telemetrySubscription(): string {
  return `${base}/+/sensors/dht`;
}
```

`+` matches exactly one topic level. This subscribes to the DHT topic of every device
without listing them, which matters because you do not know the device ids in advance.

Compare this to step 2's `spectral/esp32/#`, which matched everything including topics
you had never thought about. Two things improve:

1. You receive only what you asked for. Someone publishing debug output under your
   namespace no longer reaches your message handler.
2. The subscription itself documents what the server cares about. Read the two
   subscription functions and you know the server's entire input surface.

### `deviceIdFromTopic`

```ts
const baseLength = base.split("/").length;
const segments = topic.split("/");
const deviceId = segments[baseLength];
```

The device id is a topic segment, not part of the payload. The device never tells you
who it is, the topic it published on does. This function is how that fact gets turned
into data.

The base topic is configurable, so the position of the device id is computed rather
than hardcoded to index 2. Change `MQTT_BASE_TOPIC` in `.env` and this still works.

Note that `segments[baseLength]` is typed as `string | undefined`, not `string`. That
is the `noUncheckedIndexedAccess` setting from `tsconfig.json` doing exactly what it
was turned on for: indexing an array can miss, and the compiler makes you say what
happens when it does.

### Returning `null` rather than throwing

An unrecognised topic is not a crisis. It means someone published something
unexpected, which on a shared broker happens weekly. The server logs it and carries
on. Throwing would take down the process because a classmate typed a topic wrong.

The general rule: throw for things that mean your program is broken, return a value
for things that mean the outside world was unhelpful.

---

## `dht22.ts`

One exported function, `parseDht22Payload(payload: string)`, returning a
`Dht22ParseResult`.

### It answers the `unknown` error from step 3

Experiment 7 in step 3 produced this:

```
error TS18046: 'raw' is of type 'unknown'.
```

`JSON.parse` is typed as returning `any`, which turns the compiler off. The first
thing this function does is assign the result to a variable declared `unknown`,
which turns it back on. Everything after that is the compiler asking, one question
at a time, "how do you know?"

### The four checks, and why each one exists

```ts
try { data = JSON.parse(payload); } catch { ... }
```

`JSON.parse` throws on invalid input. The health topic publishes the plain text
`alive`, and a firmware bug can truncate a payload mid-write. Without the `try`, one
malformed message stops your server.

```ts
if (typeof data !== "object" || data === null)
```

Valid JSON is not necessarily an object. `"alive"`, `42`, and `null` are all valid
JSON. The `data === null` half is there because `typeof null` is `"object"`, a
JavaScript quirk from 1995 that has never been fixed because too much code depends on
it.

```ts
if (!("temperature" in data) || !("humidity" in data))
```

The `in` operator checks for a property and, since TypeScript 4.9, narrows the type
as it does so. This is what lets the next line destructure without a type assertion.

```ts
if (typeof temperature !== "number" || !Number.isFinite(temperature))
```

Present is not the same as usable. A failed DHT22 read can serialise as `null`, a
string, or `NaN`. `Number.isFinite` rejects `NaN` and `Infinity`, both of which are
technically numbers and neither of which you want in a database.

### No type assertions anywhere

You will see `as` used in a lot of TypeScript examples online:

```ts
const reading = JSON.parse(payload) as Dht22Reading;   // do not do this
```

That line compiles, and it is a lie. It tells the compiler "trust me, this is a
`Dht22Reading`" without checking anything. Every downstream file then believes it. At
runtime `reading.temperature` is `undefined`, it flows into your database as `null`,
and you find out from a broken chart three days later.

The parser here uses narrowing instead. By the final line the compiler has followed
the same reasoning you have, and knows `temperature` is a number because you proved
it. Nobody had to be trusted.

### A known rough edge

`[1, 2, 3]` is rejected with "missing 'temperature' or 'humidity'" rather than "not
an object", because in JavaScript an array **is** an object. The message is slightly
misleading but the payload is still correctly rejected. Fixing it means adding an
`Array.isArray` check. Whether that is worth a line of code for a case that has never
happened is a reasonable thing to disagree about.

---

## `led.ts`

Added at step 7. Two functions, both about the same contract in opposite directions.

`parseLedCommandBody(body: unknown)` checks a request body from a browser. It is the
same job as `parseDht22Payload`, from a different source. The data still came from
outside the program, so it still gets checked rather than trusted, and it still
returns a discriminated union rather than throwing.

It normalises case: `"off"` becomes `"OFF"`. The firmware compares the payload
exactly, so an un-normalised `"off"` would be ignored by the device while the API
reported success. Accept generously, send one canonical form.

`ledCommandPayload(state)` is what goes on the wire. It returns the state unchanged
today, which looks pointless. It exists so that the day the firmware wants
`{"state":"ON"}` instead of `ON`, exactly one function changes and the
`LedState` union stays the vocabulary everywhere else.

## Changed at

Step 4 (created), step 7 (`led.ts`).
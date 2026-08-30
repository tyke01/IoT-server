# `src/types/`

## Responsibility

Define the vocabulary of the project. Every shape that more than one folder needs to
agree on lives here.

## Must never

- Contain a function, a constant, or anything that exists at runtime. This folder is
  erased entirely when the code compiles. If you find yourself writing logic here,
  the file belongs somewhere else.
- Become a dumping ground for every type. A type used in exactly one file belongs in
  that file. This folder is for shared vocabulary, not all vocabulary.

## Files

| File | Contains |
|---|---|
| `device.ts` | `DeviceId`, `LedState`, `DeviceStatus`, `DeviceHealth`, `LedCommand` |
| `telemetry.ts` | `Dht22Reading`, `TelemetryRecord`, `Dht22ParseResult` |
| `messaging.ts` | `PublishFn` |
| `api.ts` | `TelemetryResponse`, `DeviceResponse`, `LedCommandResponse`, `ServerHealthResponse`, `ErrorResponse` |
| `index.ts` | Re-exports everything, so other files import from one place |

---

## The types, one at a time

### `DeviceId`

```ts
export type DeviceId = string;
```

This is a **type alias**: a second name for an existing type. `DeviceId` and `string`
are the same type as far as the compiler is concerned.

Be clear about what this does and does not buy you.

It **does** buy readability. `sendCommand(deviceId: DeviceId, state: LedState)` reads
better than `sendCommand(a: string, b: string)`, and if the representation ever
changes you edit one line.

It does **not** buy safety. This compiles happily:

```ts
const id: DeviceId = "definitely-not-a-device-id";
const other: DeviceId = someRandomString;
```

A `DeviceId` accepts any string, including the wrong one. Making the compiler reject
a plain string where a `DeviceId` is expected needs a technique called branded types,
which is in the improvements track. It is not free, and at this size the alias is the
right trade.

### `LedState`

```ts
export type LedState = "ON" | "OFF";
```

This is a **union of string literal types**, and it is the most useful thing in this
folder.

`"ON"` used as a type means the type whose only value is the string `"ON"`. The `|`
means "or". So `LedState` is not "any string", it is exactly one of two values.

What you get:

- Autocomplete offers you `"ON"` and `"OFF"` and nothing else.
- `"on"` in lowercase is a compile error, not a command your ESP32 silently ignores.
- When you write a `switch` over a `LedState`, the compiler knows there are exactly
  two cases and tells you if you forget one.

That last point is why unions beat `boolean` here. `isOn: boolean` seems simpler until
you add a third state such as `"BLINK"`, at which point every `if/else` in the
codebase is quietly wrong. A union grows by one member and the compiler shows you
every place that needs updating.

### `DeviceStatus`

```ts
export type DeviceStatus = "online" | "offline";
```

Same idea. Used from step 5, when the health topic starts meaning something.

### `Dht22Reading`

```ts
export interface Dht22Reading {
  temperature: number;
  humidity: number;
}
```

This is an **interface**: a description of an object's shape. It says an object of
this type has a `temperature` that is a number and a `humidity` that is a number.

Both properties are required. Writing `{ temperature: 24.5 }` and calling it a
`Dht22Reading` is an error. If a field were optional you would mark it `humidity?:
number`, and TypeScript would then force you to handle the `undefined` case at every
use.

This type mirrors exactly what the firmware publishes. When the firmware changes,
this changes. Treat it as the written-down version of the contract between the two
codebases.

### `TelemetryRecord`

```ts
export interface TelemetryRecord {
  deviceId: DeviceId;
  temperature: number;
  humidity: number;
  receivedAt: Date;
}
```

The obvious question: why not reuse `Dht22Reading` and add two fields?

Because they are different things that happen to overlap today.

`Dht22Reading` is **what arrived on the wire**. The device sent it. It contains only
what the device knows.

`TelemetryRecord` is **what the server holds**. The device does not know its own id
as far as the payload is concerned, that came from the topic string. It certainly
does not know when the message reached the server. Those are facts the server adds.

They will diverge. At step 8 the database gives every record an `id`, and that field
has no business existing on a wire payload. Merging them now means untangling them
later, which is harder than keeping them apart from the start.

The general rule, worth remembering well past this project: **a type for data crossing
a boundary and a type for data inside your system are separate types, even when they
look identical on day one.**

### `Date` and not a number

`receivedAt` is a `Date`, not a timestamp number and not a string.

- A `Date` cannot be accidentally compared to a temperature.
- Prisma expects `Date` for a `DateTime` column at step 8.
- `string` is the worst choice, because `"2026-08-28"` and `"28/08/2026"` are both
  strings and only one of them parses the way you expect.

Convert to a string only at the last possible moment, when the API serialises its
response.

### `DeviceHealth` and `LedCommand`

```ts
export interface DeviceHealth {
  deviceId: DeviceId;
  status: DeviceStatus;
  lastSeenAt: Date;
}

export interface LedCommand {
  deviceId: DeviceId;
  state: LedState;
}
```

`LedCommand` bundles the two things needed to send a command. Once step 6 accepts
commands from HTTP, this is the shape the API route validates against, so writing it
down now means the route has something to check.

### `Dht22ParseResult`

```ts
export type Dht22ParseResult =
  | { ok: true; reading: Dht22Reading }
  | { ok: false; error: string };
```

Added at step 4. A **discriminated union**: two possible shapes, with the `ok` field
telling you which one you are holding.

The value of it is that checking `ok` narrows the type. After `if (!result.ok)
return;`, the compiler knows `result.reading` exists. Before that check, it knows
only `result.error` does. You cannot reach the reading without handling the failure
first, because the compiler will not let you.

The tempting alternative, `{ reading?: ...; error?: ... }`, permits both fields set
and neither field set. Two states that cannot occur become two states you have to
think about anyway. Step 4 covers this in more detail.

### The response types in `api.ts`

```ts
export interface TelemetryResponse {
  deviceId: DeviceId;
  temperature: number;
  humidity: number;
  receivedAt: string;      // not Date
}
```

Added at step 6. Compare it to `TelemetryRecord`: identical except `receivedAt` is a
`string`.

JSON has no date type. Rather than let `JSON.stringify` quietly convert a `Date` and
leave your types claiming otherwise, the conversion is explicit, in
`src/api/serialize.ts`, into a type that says what actually goes over the wire.

This is the third time the same rule appears: `Dht22Reading` for the MQTT boundary,
`TelemetryRecord` for the inside, `TelemetryResponse` for the HTTP boundary. Data
crossing a boundary gets its own type. Three types that look nearly identical today
and will not in six months.

---

## `interface` or `type`?

Both describe shapes and here they are interchangeable. The differences:

| | `interface` | `type` |
|---|---|---|
| Object shapes | yes | yes |
| Unions such as `"ON" \| "OFF"` | no | yes |
| Can be extended by re-declaring the same name | yes | no |

The convention used in this project, and a common one generally: `interface` for
object shapes, `type` for everything else. Do not spend time agonising over it. Pick
one rule and apply it consistently, because consistency is worth more here than
correctness.

---

## `unknown`, and why `any` is banned

When you `JSON.parse` an MQTT payload you get back `any` by default. `any` switches
the compiler off for that value:

```ts
const data = JSON.parse(payload);
console.log(data.temprature);   // typo, compiles fine, undefined at runtime
```

Assign it to `unknown` instead and the compiler forces you to prove what it is before
you touch it:

```ts
const data: unknown = JSON.parse(payload);
console.log(data.temperature);  // error: 'data' is of type 'unknown'
```

That error is the point. It is not in your way, it is telling you that you have not
yet checked whether the thing that arrived over the network is what you assumed. Step
4 does that checking. This is the single most important idea in this folder, because
it is where the network meets your code and the network is not trustworthy.

---

## The barrel file

`index.ts` re-exports everything so imports elsewhere read:

```ts
import type { TelemetryRecord, LedState } from "../types/index.js";
```

instead of two separate imports from two files.

The honest downside: barrel files hide where a type actually lives, and in large
projects they can create circular imports that are unpleasant to debug. At this size
the readability wins. Know that the trade exists.

---

## `import type`

```ts
import type { DeviceId } from "./device.js";
```

The `type` keyword says this import is types only and disappears at compile time. The
`verbatimModuleSyntax` setting in `tsconfig.json` requires it, which is deliberate:
it makes the line between "exists at runtime" and "erased at compile time" visible in
the source rather than something you have to infer.

---

## Changed at

### `PublishFn`

```ts
export type PublishFn = (topic: string, payload: string) => Promise<void>;
```

Added at step 7. This is a **function type**: it describes a function's parameters and
return type, the same way an interface describes an object's shape.

It exists so that `src/services/` and `src/api/` can send messages without importing
anything from the mqtt library. They receive a function matching this shape, and
nothing in the type mentions MQTT, brokers, or topics as a concept. Step 7's doc
covers what that buys and what it costs.

### `LedCommandParseResult`

Same discriminated union pattern as `Dht22ParseResult`, for request bodies instead of
MQTT payloads. Two boundaries, one technique.

---

## Changed at

Step 3 (created), step 4 (`Dht22ParseResult`), step 6 (`api.ts` response types),
step 7 (`messaging.ts`, `LedCommandParseResult`, `LedCommandResponse`),
step 8 (database types).
`DeviceHealth` and `DeviceStatus` were defined at step 3 and first used at step 5.
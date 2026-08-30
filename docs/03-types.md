# Step 3: Types

**Goal:** give the project a written-down vocabulary, and see the compiler enforce it.

**Files added:** `src/types/device.ts`, `src/types/telemetry.ts`, `src/types/index.ts`

**Files changed:** none

## Nothing will behave differently

Run `npm run dev` at the end of this step and the output is identical to step 2. That
is expected, and it is worth understanding why rather than finding it disappointing.

Types are erased. They exist while the compiler is running and are gone by the time
Node executes anything. Every type in this project could be deleted and the server
would still run exactly the same way.

So what did you buy? Steps 4 through 8 are where the payment arrives. Every one of
them involves moving data between parts of the system, and every one of them is a
place where a typo or a wrong assumption becomes a bug you find at 11pm with a
multimeter in your hand. Writing the shapes down now means the compiler catches those
before you run anything.

The full explanation of each type is in [`src/types/README.md`](../src/types/README.md).
This document is about doing rather than reading, so go read that one first, then come
back.

## 1. Create the files

Three files under `src/types/`. Copy them from the repository, or better, type them
out. They are short and the typing is not the point, the reading is.

## 2. Check it compiles

```bash
npm run typecheck
```

Silence is success. `tsc --noEmit` prints nothing when everything is fine, which is
disconcerting the first time.

## 3. Break it on purpose

This is the actual exercise, and skipping it means step 3 taught you nothing.

Create a temporary file `src/scratch.ts`, paste the code below, and run
`npm run typecheck` after each block. Delete the file when you are done.

Every error message below is copied from a real run, not paraphrased.

### Experiment 1: a wrong literal

```ts
import type { LedState } from "./types/index.js";

const a: LedState = "on";
```

```
error TS2820: Type '"on"' is not assignable to type 'LedState'. Did you mean '"ON"'?
```

Notice that it guessed your intent. Without the union type, `"on"` would have been
published to the broker, the ESP32 would have compared it to `"ON"`, found no match,
and done nothing. No error anywhere. You would have gone looking at the wiring.

### Experiment 2: a missing field

```ts
import type { Dht22Reading } from "./types/index.js";

const b: Dht22Reading = { temperature: 24.5 };
```

```
error TS2741: Property 'humidity' is missing in type '{ temperature: number; }'
but required in type 'Dht22Reading'.
```

### Experiment 3: an extra field

```ts
const c: Dht22Reading = { temperature: 24.5, humidity: 60, pressure: 1013 };
```

```
error TS2353: Object literal may only specify known properties, and 'pressure'
does not exist in type 'Dht22Reading'.
```

Worth thinking about. Is this reasonable? A DHT22 does not measure pressure, so
either you meant a different sensor or you meant a different type. The compiler is
right to ask.

### Experiment 4: the right shape, the wrong types

```ts
const d: Dht22Reading = { temperature: "24.5", humidity: 60 };
```

```
error TS2322: Type 'string' is not assignable to type 'number'.
```

This is the one that matters most in practice, because `"24.5"` is exactly what you
get if you read a value out of a payload without converting it. In plain JavaScript,
`"24.5" + 1` is `"24.51"` and nobody tells you.

### Experiment 5: a string where a `Date` belongs

```ts
import type { TelemetryRecord } from "./types/index.js";

const e: TelemetryRecord = {
  deviceId: "esp32-01",
  temperature: 24.5,
  humidity: 60,
  receivedAt: "2026-08-28",
};
```

```
error TS2322: Type 'string' is not assignable to type 'Date'.
```

### Experiment 6: the alias that does not protect you

```ts
import type { DeviceId } from "./types/index.js";

const f: DeviceId = 42;
```

```
error TS2322: Type 'number' is not assignable to type 'string'.
```

Read that error carefully. It says `string`, not `DeviceId`. The compiler has already
substituted the alias, because `DeviceId` **is** `string`. Now try this:

```ts
const g: DeviceId = "this is not a device id at all";
```

No error. That is the limitation described in the types README, seen rather than
described. An alias documents intent. It does not enforce it.

### Experiment 7: `unknown` doing its job

```ts
const raw: unknown = JSON.parse('{"temperature":24.5}');
const h = raw.temperature;
```

```
error TS18046: 'raw' is of type 'unknown'.
```

This is the most valuable error in the list. It is the compiler refusing to let you
assume anything about data that arrived from outside your program. Everything on that
MQTT topic came from a device you are not currently holding, over a network, possibly
from firmware someone else flashed.

Step 4 is entirely about answering this error properly.

### Clean up

```bash
rm src/scratch.ts
```

## 4. Where the types are not yet used

Nothing imports from `src/types/` at the end of this step. That is fine and it is
temporary. Step 4 imports `Dht22Reading` and `TelemetryRecord` on its first line.

If defining vocabulary before using it feels backwards, consider that you did the
same thing on the firmware side: you decide what a struct holds before you write the
function that fills it.

## What you now have

A written contract for every shape that moves through this system, and direct
experience of the compiler enforcing it. Step 4 turns the raw string from step 2 into
a real `Dht22Reading`, and handles the case where it cannot.

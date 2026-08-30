# `src/services/`

## Responsibility

The part of the program that decides what happens. A message arrived, so what do we
do about it? A reading exists, so where does it live?

Everything else in `src/` either talks to the outside world (`mqtt/`, later `api/`
and `database/`) or describes it (`devices/`, `types/`). This folder is where the
program's own behaviour lives.

## Must never

- Know about MQTT, HTTP, or SQL. `handleMessage` takes a topic and a payload, both
  plain strings. It does not know they came from a broker, and at step 6 the same
  store will be read by an HTTP route without changing a line here.
- Be skipped. When you add a feature, this is where the "what should happen" goes.
  Putting it in a route handler or an MQTT callback is how those files grow into the
  mess `index.ts` was becoming at step 4.

## Files

| File | What it does |
|---|---|
| `message-handler.ts` | Routes an incoming message, parses it, stores it |
| `telemetry-store.ts` | Holds the most recent reading per device |
| `device-health.ts` | Tracks when each device was last heard from |
| `command-service.ts` | Sends an LED command to a device |

---

## Why this folder appeared

At the end of step 4, `index.ts` did five things: started the program, connected to
the broker, built a subscription list, routed messages by topic, and constructed
records. Step 4's doc told you to notice that and leave it alone.

Here is the concrete cost of leaving it. At step 6 an HTTP route needs the latest
reading. If the latest reading lives in a local variable inside `index.ts`, the route
cannot reach it without exporting mutable state from your entry point, which is a
mess that gets worse every step after.

Moving it here is not tidying. It is what makes step 6 possible.

`index.ts` is now back to one job: wire the pieces together and start them. Read it
top to bottom and you can see the whole program's shape in twenty lines. That is what
an entry point is for.

---

## `telemetry-store.ts`

```ts
const latestByDevice = new Map<DeviceId, TelemetryRecord>();
```

### Why a `Map` and not an object

`{}` would work. A `Map` is better here for one specific reason: **the keys come from
the network.**

A device id is a topic segment published by something you are not holding. On a plain
object, a device calling itself `__proto__`, `constructor`, or `toString` interacts
with JavaScript's prototype chain in ways that range from confusing to a security
bug. `Map` keys are just keys. Nothing is inherited, nothing is special.

Smaller benefits: `.size` instead of `Object.keys(x).length`, and `.get()` returning
`undefined` for a missing key rather than you wondering whether the key was absent or
its value was genuinely `undefined`.

### `Map<DeviceId, TelemetryRecord>`

This is the first **generic type** in the project. `Map` on its own is incomplete: a
map of what, to what? The angle brackets fill in the blanks, and the result is a type
that knows `.get()` returns `TelemetryRecord | undefined` and that
`.set(42, "hello")` is an error.

You are using a generic type here, not writing one. Writing your own is in the
improvements track, and you will not need it for a long time. Using them is
unavoidable and worth being comfortable with: `Array<string>`, `Promise<number>`,
`Map<K, V>` are all the same idea.

### `?? null`

```ts
return latestByDevice.get(deviceId) ?? null;
```

`Map.get` returns `undefined` when the key is missing. This converts that to `null`.

Why bother, when both mean "nothing"? Because at step 6 this value gets serialised to
JSON for the dashboard, and `JSON.stringify` deletes `undefined` properties while
keeping `null` ones. Picking one and converting at the boundary means the API's shape
does not change depending on whether a device has reported yet.

The rule worth taking away: allow both to exist internally if you must, but decide
which one crosses a boundary, and convert there.

### It is lost on restart

Restart the server and the store is empty. That is correct for step 5 and fixed at
step 8. Keeping the in-memory store even after the database arrives is deliberate:
answering "what is the temperature right now" from memory takes microseconds, and
from Postgres it takes a query. The store is a cache, and the database is the truth.

---

## `device-health.ts`

### Status is computed, never stored

```ts
const age = Date.now() - lastSeenAt.getTime();
status: age > OFFLINE_AFTER_MS ? "offline" : "online",
```

Only the timestamp is stored. The status is worked out at the moment somebody asks.

The alternative is storing a `status` field and updating it when things change, which
sounds simpler and is not. Going offline is not an event. Nothing happens when a
device stops publishing, that is the entire problem. To notice it you would need a
timer scanning every device on a schedule, which is more code, another thing to shut
down cleanly, and a source of stale answers between ticks.

Computed state cannot go stale. Ask at any instant and the answer is right at that
instant.

This generalises well beyond this project: **if a value can be derived from data you
already hold, derive it.** Stored copies of derivable data are how systems start
contradicting themselves.

### `OFFLINE_AFTER_MS = 15_000`

The firmware publishes a heartbeat every 5 seconds, so this is three missed in a row.

One missed heartbeat is normal. Wifi drops a packet, the device is mid-reconnect, the
broker is busy. Alerting on that gives you a system nobody trusts because it cries
wolf. Three consecutive misses is a real signal.

The underscore in `15_000` is a numeric separator. It is ignored by JavaScript and
exists purely so you can tell 15000 from 150000 at a glance.

The constant is hardcoded. If the heartbeat interval ever becomes configurable, this
has to move to `config/` alongside it, since the two numbers are meaningless apart.

### Any message counts as a heartbeat

`recordSeen` is called in `message-handler.ts` for every message, before the topic is
even inspected. A device sending temperature readings is clearly alive, whether or not
its heartbeat happened to arrive.

Treating only the health topic as proof of life would mean a device with a broken
heartbeat but working sensors gets reported as offline while data streams in from it.

---

## `message-handler.ts`

Moved wholesale out of `index.ts` at step 5, with two lines added: `recordSeen` and
`saveLatest`.

The signature matters more than the body:

```ts
export function handleMessage(topic: string, payload: string): void
```

Two strings. No `MqttClient`, no `Buffer`, nothing from the mqtt library. That is why
`index.ts` can hand this function to `onMessage` without the services folder ever
importing an MQTT type, and it is why you could test this function by calling it
directly with two strings and no broker running anywhere.

---

---

## `command-service.ts`

Added at step 7, and it is where the folder's "must never know about MQTT" rule gets
tested, because sending a command obviously requires MQTT.

The resolution is that it does not take an MQTT client. It takes a function:

```ts
export type PublishFn = (topic: string, payload: string) => Promise<void>;

export async function sendLedCommand(
  publish: PublishFn,
  deviceId: DeviceId,
  state: LedState
): Promise<LedCommand>
```

`index.ts` is the only file holding both the MQTT client and the API server, so it
builds the real function and passes it down. Everything below sees two strings and a
promise.

This is dependency injection without the machinery: a thing that needs a capability
is handed it rather than importing it. The practical payoff is that you can test this
function by passing a fake that records its arguments, with no broker anywhere.

Returning from `sendLedCommand` means the broker accepted the message. It does not
mean the device acted on it, and nothing in this folder can currently find out. Step 7's
doc explains why the API answers 202 because of this, and acknowledgements are in the
improvements track.

## Changed at

Step 5 (created), step 7 (`command-service.ts`), step 8 (writing to the database).
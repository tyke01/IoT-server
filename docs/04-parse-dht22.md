# Step 4: Parse the DHT22 payload

**Goal:** the raw string from step 2 becomes a typed `TelemetryRecord`, and a bad
payload becomes a warning instead of a crash.

**Files added:** `src/devices/topics.ts`, `src/devices/dht22.ts`

**Files changed:** `src/mqtt/client.ts`, `src/index.ts`, `src/types/telemetry.ts`,
`src/types/index.ts`

## 1. The new type

One addition to `src/types/telemetry.ts`:

```ts
export type Dht22ParseResult =
  | { ok: true; reading: Dht22Reading }
  | { ok: false; error: string };
```

This is a **discriminated union**. Two possible shapes, and the `ok` field tells you
which one you have.

Why not the obvious alternative?

```ts
// the version you will be tempted to write
interface BadResult {
  reading?: Dht22Reading;
  error?: string;
}
```

Because that type permits nonsense. Both fields set. Neither field set. The compiler
allows all four combinations and you have to remember to check. The union permits
exactly two states, which are exactly the two states that can occur.

It also narrows. Write this:

```ts
if (!result.ok) {
  logger.warn(result.error);   // compiler knows .error exists here
  return;
}
logger.info(result.reading.temperature);   // and .reading exists here
```

After the `if`, the compiler has ruled out the failure branch. `result.reading` is
available without a check and `result.error` is a compile error. You cannot forget to
handle the failure case, because the success data is unreachable until you do.

That property is the whole reason for the pattern. Compare it to the usual approach
of throwing an exception, where nothing forces the caller to catch anything.

## 2. `src/devices/`

A new folder, with topics and parsing. Read
[`src/devices/README.md`](../src/devices/README.md) for the line-by-line reasoning.
The short version:

- `topics.ts` builds and recognises topic strings, and pulls the device id out of one
- `dht22.ts` turns a payload string into a `Dht22ParseResult`

The device id comes from the topic, not the payload. Worth sitting with for a second:
the ESP32 never sends its own name. It publishes to a topic containing its name, and
the server reads the name off the envelope rather than the letter.

## 3. `src/mqtt/client.ts` changes

`subscribeToEverything` is gone. In its place:

```ts
export function subscribe(client: MqttClient, topics: string[]): void
```

The MQTT folder no longer decides what to subscribe to. It is handed a list. The list
is built in `index.ts` from the functions in `devices/topics.ts`, which is the only
place that knows a DHT topic from a health topic.

This is the rule from the `src/mqtt/` README being applied rather than described.

## 4. `src/index.ts` changes

The message handler now routes:

```
message arrives
  |
  +-- no device id in the topic?  warn, stop
  +-- telemetry topic?            parse, then either warn or build a record
  +-- health topic?               log the heartbeat
  +-- anything else?              warn about an unhandled topic
```

Note the shape of the parse handling:

```ts
const result = parseDht22Payload(payload);

if (!result.ok) {
  logger.warn(`Discarded a payload from ${deviceId}: ${result.error}`, payload);
  return;
}
```

Handle the failure and return early, then continue with the success case at the
normal indentation level. This is worth doing consistently. Code that handles every
failure first and returns reads top to bottom, while code that nests success inside
`if` blocks drifts rightwards until it falls off the screen.

Also note that the log line includes the payload that failed. A warning saying only
"bad payload" tells you a problem exists. One that shows you the bytes tells you
whether it is your firmware, your JSON, or someone else's device.

## 5. Verify

Two terminals, as before:

```bash
npm run dev
npm run mock
```

Expected:

```
2026-08-28T11:58:12.321Z [INFO] Subscribed to spectral/esp32/+/sensors/dht, spectral/esp32/+/health
2026-08-28T11:58:18.569Z [INFO] Reading from esp32-01 {
  deviceId: 'esp32-01',
  temperature: 24,
  humidity: 59,
  receivedAt: 2026-08-28T11:58:18.569Z
}
2026-08-28T11:58:20.567Z [INFO] Heartbeat from esp32-01 alive
```

Compare that to step 2's output. The reading was `{"temperature":24,"humidity":59}`,
a string, with quotes visible in the log. It is now an object with a device id and an
arrival time, and `record.temperature` is a number you can do arithmetic on.

## 6. Break it on purpose, again

This is the important part of the step. With the server running, publish some
deliberately wrong payloads. Use MQTT Explorer, MQTTX, or the command line:

```bash
mosquitto_pub -t 'spectral/esp32/esp32-01/sensors/dht' -m '{"temperature":"hot","humidity":60}'
mosquitto_pub -t 'spectral/esp32/esp32-02/sensors/dht' -m 'garbage'
```

Real output from those two commands:

```
[WARN] Discarded a payload from esp32-01: 'temperature' is not a finite number {"temperature":"hot","humidity":60}
[WARN] Discarded a payload from esp32-02: payload is not valid JSON garbage
```

Now try the rest. Every result below is from an actual run, not predicted:

| Payload | Result |
|---|---|
| `{"temperature":24.5,"humidity":60.2}` | accepted |
| `{"temperature":24.5}` | missing 'temperature' or 'humidity' |
| `not json at all` | payload is not valid JSON |
| `"alive"` | payload is not a JSON object |
| `{"temperature":"24.5","humidity":60}` | 'temperature' is not a finite number |
| `{"temperature":null,"humidity":60}` | 'temperature' is not a finite number |
| `{"temperature":24.5,"humidity":60,"extra":true}` | accepted, `extra` ignored |
| `[1,2,3]` | missing 'temperature' or 'humidity' |

Two of these deserve a moment.

**The extra field is accepted and silently dropped.** That is deliberate. If firmware
v2 starts sending a battery voltage, a server running the old code keeps working
instead of rejecting every message. Being strict about what you send and tolerant
about what you receive is a long-standing principle in protocol design, and it is why
your firmware and server can be deployed on different days.

**`[1,2,3]` gives a slightly wrong error.** An array is an object in JavaScript, so it
gets past the object check and fails on the missing properties instead. Rejected
correctly, explained imprecisely. Whether that deserves an `Array.isArray` check is a
fair thing to argue about, and noticing it at all is the skill worth having.

The server survived all of it. That is the actual result of this step. At step 2, a
payload of `garbage` would have been logged happily because nothing was interpreting
it. The moment you start interpreting data, you own the question of what happens when
it is wrong.

## 7. Something to notice about `index.ts`

It is getting long. It now connects to a broker, builds a subscription list, routes
messages by topic, parses, and constructs records. Five jobs in the file whose only
real job is starting the program.

Do not fix it yet. Step 5 moves the message handling into `src/services/` and the
reason will be obvious because you will have felt it. Noticing this now and leaving
it alone is a deliberate exercise: the discomfort is the argument for the next step.

## What you now have

Typed readings, a server that survives malformed input, and an entry point that is
starting to strain. Step 5 gives the readings somewhere to live and takes the
handling logic out of `index.ts`.

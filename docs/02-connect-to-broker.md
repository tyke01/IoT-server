# Step 2: Connect to the broker

**Goal:** raw MQTT messages appear in your terminal. Nothing is parsed, nothing is
stored, nothing is understood. We prove the pipe works before we put anything through it.

**Files added:** `src/mqtt/client.ts`, `scripts/mock-device.ts`
**Files changed:** `src/index.ts`

## 1. Why log raw strings first

It is tempting to jump straight to `JSON.parse`. Resist it for one step. If you parse
immediately and see nothing, you have three suspects: the connection, the subscription,
and the parser. If you log the raw payload first and see it arrive, you have proven two
of them work, and step 4 only has one place left to be wrong.

This is the same discipline as changing one thing at a time when debugging hardware.

## 2. The MQTT model

MQTT is publish and subscribe. Nobody addresses anybody directly.

- A **publisher** sends a message to a **topic**, a slash-separated string.
- A **subscriber** registers interest in a topic pattern.
- The **broker** forwards each message to everyone whose pattern matches.

The ESP32 does not know this server exists. This server does not know the ESP32
exists. They agree on a topic string, and the broker does the rest. That decoupling
is why you can swap a real DHT22 for a mock script and change no server code.

Our topics:

```
spectral/esp32/{deviceId}/sensors/dht     device to server, JSON
spectral/esp32/{deviceId}/health          device to server, "alive"
spectral/esp32/{deviceId}/commands/led    server to device, "ON" or "OFF"
```

## 3. `src/mqtt/client.ts`

Four exported functions, each with one job:

- `connectToBroker()` builds the client and attaches lifecycle listeners
- `subscribeToEverything(client)` subscribes to `spectral/esp32/#`
- `onMessage(client, handler)` registers the message callback
- `disconnect(client)` closes the connection cleanly

Two things to notice in the code.

**`connectToBroker` returns before it is connected.** `mqtt.connect()` starts the
handshake and returns immediately. The `"connect"` event fires later. This is normal
asynchronous behaviour and the library queues anything you publish in the meantime.

**The payload is a `Buffer`.** Not a string. A `Buffer` is Node's type for raw bytes.
MQTT transports bytes and has no opinion about what they mean. JSON is a convention
we agreed on, not part of the protocol. `.toString()` decodes those bytes as text,
which is why `onMessage` hands your callback a `string` and hides the `Buffer` from
the rest of the program.

## 4. Wildcards

| Symbol | Matches | Example |
|---|---|---|
| `+` | exactly one level | `spectral/esp32/+/health` matches every device's health |
| `#` | this level and everything below, must be last | `spectral/esp32/#` matches all of it |

We use `#` here because we are exploring and want to see everything, including
messages we did not expect. Step 4 replaces it with explicit topics, because
subscribing to traffic you did not ask for is a habit that costs bandwidth and hides
bugs in production.

## 5. Graceful shutdown

```ts
process.on("SIGINT", () => void shutdown());
```

`SIGINT` is the signal Ctrl+C sends. Without this handler, the process dies while the
broker still believes you are connected, and your client id stays occupied for a
while. Reconnect with the same id before the broker notices and it may refuse or
disconnect you. This is a real bug that looks like a random flaky connection, and
three lines prevent it.

The `void` prefix says "I know this returns a Promise and I am deliberately not
awaiting it." Without it, some linters flag a floating promise.

## 6. Running without hardware

```bash
npm run mock
```

`scripts/mock-device.ts` connects to the same broker and publishes to the same topics
with the same payload shapes as the real firmware. It does a small random walk so the
numbers move like a room rather than a noise generator, publishes health every 5
seconds and readings every 3, and subscribes to its own LED command topic so it can
log commands when you reach step 7.

It lives in `scripts/`, not `src/`, because it is a development tool, not part of the
server. That distinction matters: `src/` is what you deploy, `scripts/` is what you
use while building.

Set `MOCK_DEVICE_ID` in your `.env` to your own name if you share a broker with
classmates, otherwise your readings and theirs mix on the same topic and everyone is
confused.

### On the ESP32 instead

If you would rather run the mock on real hardware, the firmware has a
`USE_MOCK_SENSOR` compile-time flag. With it enabled, the firmware skips the DHT22
read and generates values in the identical JSON shape. Everything downstream is
unchanged. This is worth doing at least once: the fact that the server cannot tell
the difference is the clearest demonstration of what "the contract is the topic and
the payload" actually means.

## 7. Verify

Two terminals:

```bash
npm run dev     # terminal 1
npm run mock    # terminal 2
```

Expected in terminal 1:

```
2026-08-28T09:14:02.114Z [INFO] Starting IoT server
2026-08-28T09:14:02.115Z [INFO] Connecting to broker at mqtts://xxxx.s1.eu.hivemq.cloud:8883
2026-08-28T09:14:03.402Z [INFO] Connected as iot-server-a91f3c
2026-08-28T09:14:03.560Z [INFO] Subscribed to spectral/esp32/#
2026-08-28T09:14:06.612Z [INFO] Message on spectral/esp32/esp32-01/sensors/dht {"temperature":24.1,"humidity":59.8}
2026-08-28T09:14:08.115Z [INFO] Message on spectral/esp32/esp32-01/health alive
```

That JSON is still a string. Look at the quotes in the log. Turning it into something
with a `.temperature` you can use is step 4, and it needs types first, which is step 3.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Connects and disconnects in a loop | Duplicate client id. Two things using the same one, or a previous run that did not shut down cleanly |
| Hangs with no error, no connect | Wrong scheme or port. HiveMQ Cloud needs `mqtts://` and 8883 |
| `Connection refused: Not authorized` | Wrong username or password, or the broker user lacks permission on that topic |
| Connects, subscribes, no messages | Nothing is publishing. Check with MQTT Explorer before touching your code |
| Messages from someone else's device | Shared broker, and `#` matches everything. Set your own `MOCK_DEVICE_ID` |

## What you now have

A server that connects to a broker, survives reconnects, receives every message under
your namespace, and shuts down cleanly. It understands none of it. Step 3 gives it
vocabulary.

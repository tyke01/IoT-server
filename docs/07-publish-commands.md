# Step 7: Publish commands

**Goal:** a button in a dashboard turns on an LED on your desk.

**Files added:** `src/devices/led.ts`, `src/services/command-service.ts`,
`src/api/routes/commands.ts`, `src/types/messaging.ts`

**Files changed:** `src/mqtt/client.ts`, `src/api/server.ts`, `src/index.ts`,
`src/types/device.ts`, `src/types/api.ts`, `src/types/index.ts`

## 1. The endpoint

```
POST /api/devices/:deviceId/led
Content-Type: application/json

{ "state": "ON" }
```

Responds `202 Accepted`:

```json
{"deviceId":"esp32-01","state":"ON","sentAt":"2026-08-28T17:52:15.134Z"}
```

## 2. Why 202 and not 200

This is the most important decision in the step, and it is one line of code.

`200 OK` means the thing you asked for happened. `202 Accepted` means your request
was taken and will be acted on, and the outcome is not known yet.

Look at what the server actually knows when it replies. It published to the broker.
The broker acknowledged receipt, because we publish at QoS 1. That is where its
knowledge ends. It does not know whether the ESP32 is connected, whether it is
subscribed to that topic, whether it parsed the payload, or whether the LED came on.
The device is not on the other end of this HTTP request. The broker is.

Answering `200 OK` would be claiming something you cannot know. `202` is the honest
answer.

This is not pedantry about status codes. It shapes the dashboard: a button that goes
green on a 202 is lying to the user. What it should do is show "sent" and then wait
for the device to report back, which is the acknowledgements improvement. Getting the
status code right now means the gap is visible rather than hidden.

## 3. Validating the body

`request.body` is data from the outside world, exactly like an MQTT payload. It gets
the same treatment: `parseLedCommandBody` in `src/devices/led.ts` returns a
`LedCommandParseResult`, the same discriminated union pattern as step 4.

Four checks, and every one has a matching real response below:

| Body sent | Response |
|---|---|
| `{"state":"ON"}` | 202, `{"deviceId":"esp32-01","state":"ON","sentAt":"..."}` |
| `{"state":"off"}` | 202, normalised to `"OFF"` |
| `{"state":"BLINK"}` | 400, `{"error":"'state' must be one of ON, OFF, got \"BLINK\""}` |
| `{"state":true}` | 400, `{"error":"'state' must be a string"}` |
| `{}` | 400, `{"error":"body must contain a 'state' field"}` |
| `"ON"` | 400, `{"error":"body must be a JSON object"}` |

Two things worth pointing out.

**Lowercase is accepted and normalised.** `"off"` becomes `"OFF"` before it is
published. The firmware compares the payload exactly, so `"off"` on the wire would be
silently ignored by the device while the API reported success. Normalising at the
boundary means one canonical form exists inside the system. Be liberal about what you
accept, strict about what you send.

**The error messages name the problem.** `'state' must be one of ON, OFF, got
"BLINK"` tells whoever is building the dashboard exactly what to fix. `400 Bad
Request` with no body tells them to start guessing.

### One case the parser never sees

Send a completely empty body and you get this instead:

```json
{"statusCode":400,"code":"FST_ERR_CTP_EMPTY_JSON_BODY","error":"Bad Request","message":"Body cannot be empty when content-type is set to 'application/json'"}
```

That is Fastify, not our code. It rejects the request before the handler runs, because
the request claimed `Content-Type: application/json` and then sent nothing.

Correct behaviour, inconsistent shape. Every error our code produces looks like
`{"error":"..."}` and this one does not. A dashboard reading `body.error` gets
`"Bad Request"` here and a useful sentence everywhere else. Step 9 adds an error
handler that gives every failure the same shape, and this is the reason it needs one.

## 4. Commands to unknown devices are published anyway

```bash
curl -X POST http://localhost:3000/api/devices/never-seen/led \
  -H "Content-Type: application/json" -d '{"state":"ON"}'
```

Real response: `202`, and the server published to
`spectral/esp32/never-seen/commands/led`.

No 404. That may look like a missing check, and it is deliberate.

The server has no list of devices that exist. It has a list of devices it has *heard
from*, which is a different thing. A freshly flashed ESP32 that has subscribed to its
command topic but not yet published a reading is a real device this server has never
seen. Refusing to command it would be wrong.

This is MQTT's decoupling showing through the API. Publisher and subscriber never know
about each other, and the broker will not tell you whether anyone is listening. A
message to a topic nobody subscribes to is simply discarded, silently, by design.

If you want "no such device" to be an error, you need a registry of known devices,
which is a database table and a registration step. That is in the improvements track.
Until then, an unknown device id is a topic nobody is listening on, and that is not
something this server can detect.

## 5. How `publish` reaches the API without breaking the rules

`src/services/` must not know about MQTT. `src/api/` must not either. But a route
needs to publish. So how?

The API is handed a function, not a client:

```ts
// src/types/messaging.ts
export type PublishFn = (topic: string, payload: string) => Promise<void>;
```

```ts
// src/index.ts
const publishMessage: PublishFn = (topic, payload) => publish(client, topic, payload);
const app = await startApiServer(publishMessage);
```

`index.ts` is the only file that has both the MQTT client and the API server, so it is
the only place that can connect them. Everything downstream receives a function that
takes two strings and returns a promise. Nothing about MQTT appears in its type.

Three consequences:

- `command-service.ts` could be tested by passing it a function that records what it
  was called with. No broker required.
- Swapping MQTT for something else means changing `index.ts` and nothing else.
- Nobody can reach the MQTT client from a route and start doing something creative
  with it, because they do not have it.

**This is dependency injection.** Not the framework version with decorators and
containers, just the idea: a thing that needs a capability is given it, rather than
reaching out and fetching it.

Notice the cost too. `publish` is threaded from `index.ts` into `startApiServer`,
into `registerCommandRoutes`, into `sendLedCommand`. Four layers of passing one
argument. With two or three dependencies that is fine. With ten it becomes noise, and
that is the point where the class-based version with a container starts paying for
itself. It is in the improvements track, and you now know what problem it solves.

## 6. QoS 1 on publish

```ts
client.publish(topic, payload, { qos: 1 }, callback);
```

Telemetry can afford to lose a message: another one arrives in three seconds. A
command cannot. QoS 1 means the broker keeps retrying until it acknowledges receipt.

The trade is that "at least once" allows duplicates. For an LED this does not matter,
since `ON` twice is the same as `ON` once. That property is called idempotence and it
is worth checking before choosing QoS 1 for a command. `TOGGLE` would not be
idempotent, and delivering it twice would leave the LED in the wrong state. Prefer
commands that state the desired result over commands that describe a change.

## 7. Verify

Start the server and the mock, then:

```bash
curl -X POST http://localhost:3000/api/devices/esp32-01/led \
  -H "Content-Type: application/json" -d '{"state":"ON"}'
```

Server log:

```
[INFO] Sent ON to esp32-01 on spectral/esp32/esp32-01/commands/led
```

Mock device log:

```
[INFO] Mock LED command received on spectral/esp32/esp32-01/commands/led ON
```

Real timestamps from that run: the server logged at 17:52:15.134 and the mock received
at 17:52:15.137. Three milliseconds for HTTP to broker to subscriber.

On real hardware, the LED lights.

## 8. Now walk the whole loop

This is the moment the project is worth stopping on, because every piece is in place.
Trace a single button press:

```
browser  --HTTP POST-->  api/routes/commands.ts
                              |  parseLedCommandBody
                              v
                         services/command-service.ts
                              |  ledCommandTopic + ledCommandPayload
                              v
                         mqtt/client.ts  --publish-->  broker
                                                          |
                                                          v
                                                       ESP32, LED on
```

And a reading coming back:

```
ESP32  --publish-->  broker  -->  mqtt/client.ts
                                       |
                                       v
                                  services/message-handler.ts
                                       |  parseDht22Payload
                                       v
                                  services/telemetry-store.ts
                                       |
                                  api/routes/telemetry.ts  --HTTP-->  browser
```

Both directions cross the same four layers in opposite order. Neither direction has a
file that knows about more than its neighbours. That symmetry is not decoration, it is
what makes the next sensor a small change.

Add a BME280 now and the work is: a parser in `devices/`, a topic matcher in
`devices/topics.ts`, a branch in `message-handler.ts`. The broker connection, the
store, the API server, and the entry point are all untouched.

## What you now have

A complete bidirectional loop. Data in, commands out, both validated at the boundary,
both with types that describe what actually crosses each edge.

Everything is still in RAM. Restart and the store is empty, as you already saw with
`001` in your own testing. Step 8 adds Postgres, and the question it answers is not
"what is the temperature now" but "what was it at 3am on Tuesday".

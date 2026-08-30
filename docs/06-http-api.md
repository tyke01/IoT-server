# Step 6: The HTTP API

**Goal:** a browser can ask this server what the temperature is.

**Files added:** `src/api/server.ts`, `src/api/serialize.ts`,
`src/api/routes/system.ts`, `src/api/routes/telemetry.ts`,
`src/api/routes/devices.ts`, `src/types/api.ts`

**Files changed:** `src/config/env.ts`, `src/index.ts`, `src/types/index.ts`,
`package.json`, `.env.example`

## 1. Install

```bash
npm install fastify @fastify/cors
```

Fastify is the HTTP server. `@fastify/cors` is the plugin that lets a browser on a
different port read the responses, explained in section 5.

## 2. Configuration

Three new variables, all optional with defaults:

```
HTTP_PORT=3000
HTTP_HOST=0.0.0.0
CORS_ORIGIN=http://localhost:3001
```

`HTTP_HOST` defaults to `0.0.0.0`, meaning listen on every network interface. Use
`127.0.0.1` to accept connections only from your own machine. On a shared network,
`0.0.0.0` means a classmate can reach your API, which is useful for testing and
something to be aware of.

The port has its own validation helper:

```ts
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`${name} must be a port number between 1 and 65535, got "${raw}"`);
}
```

`Number("abc")` is `NaN`, and `NaN` passed to `listen()` produces a confusing failure
some distance from the actual mistake. Five lines here turn it into a clear message
at startup. Step 9 applies this idea to every variable.

## 3. The endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | server liveness |
| GET | `/api/telemetry/latest` | every device's latest reading |
| GET | `/api/telemetry/latest/:deviceId` | one reading, 404 if unknown |
| GET | `/api/devices` | status plus latest reading per device |
| GET | `/api/devices/:deviceId` | one device, 404 if unknown |

`/health` and `/api/devices` are both called health and mean completely different
things. One is "is this Node process alive", the other is "is the ESP32 alive". The
[`src/api/README.md`](../src/api/README.md) explains why they must stay separate and
why `/health` must never touch the broker.

## 4. Why `serialize.ts` exists

The store holds `TelemetryRecord`, with `receivedAt` as a `Date`. The API sends
`TelemetryResponse`, with `receivedAt` as a `string`.

You could skip the conversion. `JSON.stringify` turns a `Date` into an ISO string on
its own, so the output would look identical.

The problem is that your types would then be lying. The route's return type would say
`Date` while the client receives a string. Nobody notices until step 8, when
`TelemetryRecord` gains a database `id` and that field appears in your public API
because nothing was deciding what to expose.

One file, two small functions, and the API's shape becomes a thing you chose rather
than a thing that happened.

## 5. Verify

Start everything:

```bash
npm run dev
npm run mock
```

The startup log now has a new line:

```
[INFO] Connecting to broker at mqtt://localhost:1883
[INFO] API listening on http://0.0.0.0:3000
[INFO] Connected as iot-server-d5665d
[INFO] Subscribed to spectral/esp32/+/sensors/dht, spectral/esp32/+/health
[INFO] Stored 24.1C 59.3% from esp32-01, 1 device(s) tracked
```

Now call it. Every response below is real output from a running server.

```bash
curl http://localhost:3000/health
```

```json
{"status":"ok","uptimeSeconds":13}
```

```bash
curl http://localhost:3000/api/telemetry/latest
```

```json
[{"deviceId":"esp32-01","temperature":24.1,"humidity":58.3,"receivedAt":"2026-08-28T14:29:40.340Z"}]
```

```bash
curl http://localhost:3000/api/devices/esp32-01
```

```json
{"deviceId":"esp32-01","status":"online","lastSeenAt":"2026-08-28T14:29:40.340Z","latest":{"deviceId":"esp32-01","temperature":24.1,"humidity":58.3,"receivedAt":"2026-08-28T14:29:40.340Z"}}
```

And the failure cases, which matter as much:

```bash
curl -i http://localhost:3000/api/telemetry/latest/nope
```

```
HTTP/1.1 404 Not Found
{"error":"No reading stored for device nope"}
```

```bash
curl -i http://localhost:3000/api/devices/nope
```

```
HTTP/1.1 404 Not Found
{"error":"Unknown device nope"}
```

Open `http://localhost:3000/api/devices` in a browser too. Firefox and Chrome both
render JSON readably, which is the fastest way to watch the data change while the
mock runs.

## 6. Delete the snapshot timer

The four lines in `index.ts` that logged a snapshot every 15 seconds are gone. That
was a temporary way to see inside the store, and now you can just ask the API.

Notice that deleting it required no changes anywhere else. The store did not know the
timer existed, and it does not know the routes exist either. That is what keeping
`services/` free of transport concerns bought you.

## 7. Watch a device go offline, again

Repeat step 5's exercise, but through the API this time:

```bash
curl http://localhost:3000/api/devices
```

Stop the mock, wait 15 seconds, and call it again. `status` becomes `offline` while
`latest` still holds the final reading.

Nothing computed that on a schedule. The status was worked out at the moment your
request arrived. This is the same point as step 5, and it is worth seeing through
HTTP because it is exactly what the dashboard will experience.

## 8. Connecting a Next.js dashboard

The API is now reachable from a browser. A minimal client-side fetch:

```ts
const response = await fetch("http://localhost:3000/api/devices");
const devices = await response.json();
```

Run your Next.js app on port 3001 so it does not fight this server for 3000, and make
sure `CORS_ORIGIN` in `.env` matches.

### If you get a CORS error

Read the CORS section of [`src/api/README.md`](../src/api/README.md) before changing
anything. The short version, which surprises most people:

`curl` works and the browser does not, because **the server is not blocking you, the
browser is.** With a string origin configured, the plugin sends
`access-control-allow-origin: http://localhost:3001` on every response no matter who
asked. Verified with a request carrying `Origin: http://evil.example`, which got that
same header back. The browser then compares the header to the page's own origin and
refuses to hand the response to your JavaScript.

Two things follow. The fix is always on the server, never in the browser. And CORS is
not security: it protects the user's browsing session, not your API. Anything that
genuinely needs protecting needs authentication.

### Polling, for now

Your dashboard will call `fetch` on a timer, probably every few seconds. That works
and it is what most tutorials do.

It is also wasteful: most requests return data identical to the last one, and your
dashboard is always up to a poll interval behind. The improvements track replaces
this with Server-Sent Events, where the server pushes updates as they arrive.

Build the polling version first. The improvement makes sense once you have watched a
dashboard sit three seconds behind a temperature you can see changing in the server
log.

## What you now have

A running HTTP API over the in-memory store, with proper status codes and a response
shape you chose. The data still vanishes on restart. Step 7 closes the loop in the
other direction by letting the dashboard turn the LED on.

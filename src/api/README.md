# `src/api/`

## Responsibility

Speak HTTP. Turn a request into a call to `src/services/`, and turn the result into
JSON.

## Must never

- Contain a decision. If a route is working out whether a device counts as offline,
  that logic belongs in `services/`. A route should read as: ask, convert, reply.
- Hand out an internal object directly. What the server holds and what the API sends
  are different types on purpose. See "the boundary" below.

## Files

| File | What it does |
|---|---|
| `server.ts` | Builds the Fastify instance, registers CORS and routes, listens |
| `serialize.ts` | Converts internal records into response shapes |
| `routes/system.ts` | `GET /health`, is this server alive |
| `routes/telemetry.ts` | `GET /api/telemetry/latest`, readings |
| `routes/devices.ts` | `GET /api/devices`, device status with its latest reading |
| `routes/commands.ts` | `POST /api/devices/:deviceId/led`, send a command |

---

## The endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{ status, uptimeSeconds }` |
| GET | `/api/telemetry/latest` | array of readings, one per device |
| GET | `/api/telemetry/latest/:deviceId` | one reading, or 404 |
| GET | `/api/devices` | array of devices with status and latest reading |
| GET | `/api/devices/:deviceId` | one device, or 404 |
| POST | `/api/devices/:deviceId/led` | 202 with the command sent, or 400 |

### `/health` is not about your ESP32

Two different things are called health in this project and confusing them causes real
outages.

`/health` answers "is this Node process alive and serving requests". Deployment tools,
load balancers, and uptime monitors poll it. It must never touch the broker or the
database, because if it did, a slow database would make your monitoring think the
server had died and restart a perfectly healthy process.

`/api/devices` answers "is the ESP32 alive". That is domain data, and it lives under
`/api` with everything else.

The naming is unfortunate and it is also the convention, so it is worth knowing rather
than working around.

---

## The boundary

`getAllLatest()` returns `TelemetryRecord[]`. The route does not send those. It maps
them through `toTelemetryResponse` into `TelemetryResponse[]` first.

That looks like pointless copying. It is not, and the reason is in the type:

```ts
receivedAt: Date;      // TelemetryRecord, what the server holds
receivedAt: string;    // TelemetryResponse, what the API sends
```

JSON has no date type. Send a `Date` and `JSON.stringify` silently calls
`.toISOString()` on it, so the client receives a string while your TypeScript type
still claims `Date`. Your types now describe something that is not true, and at step
8 when a `TelemetryRecord` gains a database `id`, that field appears in your public
API without anyone deciding it should.

`serialize.ts` is the only place in the project where a `Date` becomes a string.
Convert at the boundary, once, deliberately.

This is the same rule as `Dht22Reading` versus `TelemetryRecord` from step 3, applied
at the other end of the system. Data crossing a boundary gets its own type.

---

## Route handler shape

```ts
app.get("/api/telemetry/latest", () => {
  return getAllLatest().map(toTelemetryResponse);
});
```

Return a value and Fastify serialises it to JSON with a 200. No `reply.send` needed
for the normal case.

For errors, use `reply`:

```ts
if (record === null) {
  return reply.code(404).send({ error: `No reading stored for device ${id}` });
}
```

404 rather than 200 with an empty body, because the two mean different things. An
empty array from `/api/telemetry/latest` means "no devices have reported", which is a
valid state. A request for a device that has never existed is a mistake by the caller,
and the status code is how you say so.

---

## Typed route parameters

```ts
interface DeviceParams {
  deviceId: string;
}

app.get<{ Params: DeviceParams }>("/api/telemetry/latest/:deviceId", ...);
```

Without the type parameter, `request.params` is typed as `unknown` and you cannot read
`.deviceId` from it. This tells Fastify what the URL pattern produces.

You are using a generic type here, not writing one, exactly as with
`Map<DeviceId, TelemetryRecord>` at step 5. The angle brackets fill in a blank that
the library left open.

Note what this does **not** do: it does not check anything at runtime. `deviceId` is
whatever was in the URL, including an empty string or 400 characters of nonsense.
TypeScript describes the shape, it does not enforce it on data from outside. That is
the same lesson as step 4's parser, and step 9 adds the runtime check.

---

## CORS, and who actually enforces it

```ts
await app.register(cors, { origin: config.http.corsOrigin });
```

Without this, a Next.js dashboard on `localhost:3001` calling this API on
`localhost:3000` gets a browser error about a missing
`Access-Control-Allow-Origin` header, while `curl` against the same URL works fine.

That difference confuses people, so be precise about what is happening.

**The server is not blocking anything.** With a string origin configured, this plugin
sends `access-control-allow-origin: http://localhost:3001` on every response,
whoever asked. Verified: a request with `Origin: http://evil.example` still gets that
exact header back.

**The browser does the blocking.** It compares the header against the page's own
origin, sees they differ, and refuses to let the JavaScript read the response. The
request was still made. The server still handled it. The browser just will not hand
over the result.

Two consequences worth internalising:

1. CORS is not a security control. It protects the user's browser session, not your
   server. `curl`, Postman, and any script ignore it completely. Anything that
   actually needs protecting needs authentication, which is step 9 and the
   improvements track.
2. If your dashboard gets a CORS error, the fix is on the server, not the client.
   Nothing you write in the browser can grant permission the server did not send.

`CORS_ORIGIN` defaults to `http://localhost:3001`, the usual Next.js dev port when
3000 is taken by this server. Change it in `.env` if your dashboard runs elsewhere.

---

## About `app.register`

`register` is Fastify's plugin system, and it has a concept called encapsulation
where plugins get their own scope. That is genuinely useful and genuinely confusing,
and this project does not use it.

Registering somebody else's plugin, as with `@fastify/cors`, is just how you install
it. Our own routes are plain functions taking the app instance, which keeps the whole
thing readable.

The improvements track covers converting these to real plugins, and the reason to do
it, which is that this file grows a line per route forever.

---

## Changed at

### 202 on the command route

`POST /api/devices/:deviceId/led` answers `202 Accepted`, never `200 OK`.

The server published to the broker and the broker acknowledged it. That is all it
knows. It has no idea whether the ESP32 is connected, subscribed, or working. The
device is not the other end of this HTTP request, the broker is. `200` would claim
knowledge the server does not have.

The route also receives `publish` as an argument rather than importing an MQTT
client, which is how `src/api/` keeps its promise not to know about transports other
than HTTP.

---

## Changed at

Step 6 (created), step 7 (`routes/commands.ts`), step 8 (history endpoint),
step 9 (request validation and error handling).
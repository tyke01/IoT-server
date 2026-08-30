# IoT Server

A small Node.js and TypeScript server that sits between an ESP32 and a web
dashboard. It listens to sensor data over MQTT, keeps it, exposes it over HTTP, and
sends commands back to the device.

It is built for one sensor (a DHT22 temperature and humidity sensor) and one output
device (an LED). That is deliberate. Once you can trace a single reading all the way
from the ESP32 to a browser and a single command all the way back, adding a second
sensor is a small change instead of a mystery.

---

## 1. What it does

```
                    +--------------------------+
                    |        MQTT Broker       |
                    |       (HiveMQ Cloud)     |
                    +------------+-------------+
                       ^         |         ^
        publishes      |         |         |     publishes
        telemetry      |         |         |     commands
                       |         v         |
   +---------+         |   +-----------------------+         +----------------+
   | ESP32   |---------+   |   THIS SERVER         |         |  Next.js       |
   | DHT22   |             |   Node + TypeScript   |<--HTTP--|  dashboard     |
   | LED     |<------------|                       |-------->|  (browser)     |
   +---------+             +-----------+-----------+         +----------------+
                                       |
                                       v
                               +---------------+
                               |  PostgreSQL   |
                               |  (Prisma)     |
                               +---------------+
```

Note one thing in that diagram: the browser never talks to the broker. It talks to
this server, and only this server holds the broker credentials. That is the whole
reason this server exists.

## 2. The full flow, end to end

**Telemetry, device to browser:**

1. The ESP32 reads the DHT22 and publishes JSON to `spectral/esp32/{deviceId}/sensors/dht`.
2. The broker receives it and forwards it to every subscriber of that topic.
3. This server is subscribed, so its message handler fires with a topic and a raw byte payload.
4. The payload is parsed into a typed `DHT22Reading`.
5. The reading is stored, both in memory (for "what is the value right now") and in Postgres (for history).
6. The dashboard calls `GET /api/telemetry/latest` and renders it.

**Commands, browser to device:**

1. A button in the dashboard sends `POST /api/devices/{deviceId}/led` with `{ "state": "ON" }`.
2. This server validates it and publishes `ON` to `spectral/esp32/{deviceId}/commands/led`.
3. The broker forwards it to the ESP32.
4. The ESP32's callback fires and drives the LED pin.

## 3. Topics

| Topic                                    | Direction        | Payload                                |
| ---------------------------------------- | ---------------- | -------------------------------------- |
| `spectral/esp32/{deviceId}/sensors/dht`  | device to server | `{"temperature":24.5,"humidity":61.2}` |
| `spectral/esp32/{deviceId}/health`       | device to server | `alive` (plain text, every 5s)         |
| `spectral/esp32/{deviceId}/commands/led` | server to device | `ON` or `OFF`                          |

The contract is the topic plus the payload shape. Nothing else. This is why a mock
publisher running on your laptop is indistinguishable from a real ESP32 as far as
this server is concerned.

## 4. Folder guide

Each folder has its own README explaining what it owns and, just as importantly,
what it must never do.

| Folder          | Responsibility                                                         | Docs                                                                 |
| --------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/config/`   | Read and check environment variables, expose one typed config object   | [README](src/config/README.md)                                       |
| `src/mqtt/`     | Connect to the broker, subscribe, publish. Nothing about DHT22 or LEDs | [README](src/mqtt/README.md)                                         |
| `src/utils/`    | Small helpers with no business meaning, like logging                   | [README](src/utils/README.md)                                        |
| `src/types/`    | Shared type definitions, explained one by one                          | [README](src/types/README.md)                                        |
| `src/devices/`  | DHT22 parsing and LED command building                                 | [README](src/devices/README.md)                                      |
| `src/services/` | Coordination and the in-memory latest reading                          | [README](src/services/README.md)                                     |
| `src/api/`      | Fastify HTTP server and routes                                         | [README](src/api/README.md)                                          |
| `src/database/` | Prisma client and the save and query functions                         | [README](src/database/README.md)                                     |
| `src/prisma/`   | Generated Prisma contract and client. Do not edit the generated files  | [database README](src/database/README.md)                            |
| `scripts/`      | Developer tools that are not part of the server, like the mock device  | [mock device](docs/02-connect-to-broker.md#running-without-hardware) |
| `firmware/`     | The ESP32 sketch: reads the DHT22, publishes, drives the LED           | [README](firmware/README.md)                                         |

Folders appear as the build reaches them. An empty folder teaches nothing.

## 5. Build steps

The server is built in small commits. Each step has a document explaining what
changed and why.

| Step | Document                                              | State at the end of it                         |
| ---- | ----------------------------------------------------- | ---------------------------------------------- |
| 0    | [Prerequisites](docs/00-prerequisites.md)             | Tools installed, broker credentials in hand    |
| 1    | [Project setup](docs/01-project-setup.md)             | TypeScript project that runs and prints a line |
| 2    | [Connect to the broker](docs/02-connect-to-broker.md) | Raw MQTT messages appear in your terminal      |
| 3    | [Types](docs/03-types.md)                             | Shared types defined and explained             |
| 4    | [Parse the DHT22 payload](docs/04-parse-dht22.md)     | Raw bytes become a typed reading               |
| 5    | [Keep the latest reading](docs/05-in-memory-store.md) | State lives outside the MQTT callback          |
| 6    | [HTTP API](docs/06-http-api.md)                       | `GET /api/telemetry/latest` works              |
| 7    | [Publish commands](docs/07-publish-commands.md)       | `POST /api/devices/:id/led` drives the LED     |
| 8    | [Store in Postgres](docs/08-postgres-prisma.md)       | History survives a restart                     |
| 9    | Hardening                                             | Validation, error handling, structured logging |

**You are here: end of step 8.**

## 6. Improvements

Everything the core build deliberately leaves out lives in
[docs/improvements/](docs/improvements/README.md). Read those only after step 9.
Each one starts from a problem you will have actually felt by then, which is the
only good reason to add complexity.

## 7. Quick start

```bash
npm install
cp .env.example .env      # then fill in your broker credentials
npm run dev               # start the server, API on http://localhost:3000
npm run mock              # in a second terminal, if you have no hardware
```

Then:

```bash
curl http://localhost:3000/api/devices
```

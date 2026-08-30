# Step 0: Prerequisites

Nothing is built in this step. It exists so that step 1 does not stall on a missing
install.

## 1. Node.js

Version 20 or newer.

```bash
node --version
npm --version
```

If `node` is not found, install the LTS build from nodejs.org. On Windows, use the
official installer, it puts npm on your PATH correctly.

## 2. An editor with TypeScript support

VS Code is assumed throughout. TypeScript support is built in, you do not need an
extension for it. Useful additions: ESLint, Prettier, and Thunder Client or REST
Client for calling the API from step 6.

## 3. A broker account

We use HiveMQ Cloud's free tier. Write down three things before step 1:

- The cluster URL, which looks like `xxxxxxxx.s1.eu.hivemq.cloud`
- A username you created under Access Management
- The password for that username

The TLS port is 8883 and we connect with the `mqtts://` scheme. Plain `mqtt://` on
port 1883 will not work against HiveMQ Cloud, and the failure looks like a connection
that never completes rather than a clear error. Get this right now and save yourself
the debugging session.

## 4. An MQTT client for sanity checks (recommended)

MQTT Explorer or MQTTX. When your server shows nothing, the first question is always
"is anything actually being published?" A second client answers that in ten seconds
and stops you debugging code that was never wrong.

## 5. Hardware, or not

You need an ESP32. You do not need a DHT22.

- **With a DHT22:** flash the course firmware and publish real readings.
- **Without one:** either run `npm run mock` on your laptop, or flash the firmware
  with the mock sensor flag enabled so the ESP32 itself generates plausible values.
  Both are covered in step 2.

Both paths produce identical topics and payloads. Nothing later in this build depends
on which one you use.

## 6. Postgres (not yet)

Step 8 needs PostgreSQL. Do not install it now. Install it when you get there, in the
context of actually using it. Step 8 covers the native installer and a hosted free
tier.

## Checklist

- [ ] `node --version` prints v20 or higher
- [ ] Editor shows TypeScript errors inline
- [ ] Broker URL, username, and password written down
- [ ] MQTT Explorer or MQTTX installed
- [ ] ESP32 present, DHT22 optional

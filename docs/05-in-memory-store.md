# Step 5: Keep the latest reading

**Goal:** readings survive past the message handler, device health becomes a real
answer, and `index.ts` goes back to doing one job.

**Files added:** `src/services/telemetry-store.ts`, `src/services/device-health.ts`,
`src/services/message-handler.ts`

**Files changed:** `src/index.ts`

## 1. The problem step 4 left behind

At the end of step 4 a reading was parsed, logged, and thrown away. The next message
overwrote nothing because nothing was kept. Ask the server "what is the temperature
in the lab" and it has no idea, despite having been told forty times in the last two
minutes.

Step 6 needs an answer to that question, because that is what the dashboard will ask.
So the reading needs somewhere to live, and that somewhere cannot be inside the MQTT
callback.

## 2. Three new files, and why three

Read [`src/services/README.md`](../src/services/README.md) for the detail. The
division:

- `telemetry-store.ts` holds the newest reading per device
- `device-health.ts` holds when each device was last heard from
- `message-handler.ts` is the routing logic, moved wholesale out of `index.ts`

They are separate files because they will change for different reasons. Step 8 gives
the store a database behind it and does not touch health. A change to the offline
threshold touches health and nothing else. Files that change together belong together,
files that do not, do not.

## 3. `index.ts` shrinks

Before, at step 4, it connected, subscribed, routed, parsed, and built records.

Now:

```ts
const client = connectToBroker();
subscribe(client, [telemetrySubscription(), healthSubscription()]);
onMessage(client, handleMessage);
```

Three lines that read like a description of the program. That is what an entry point
should look like: it wires pieces together and starts them, and every actual decision
happens elsewhere.

There is also a temporary snapshot logger on a 15 second timer, clearly marked. It
exists so you can see the store working before there is an API to query it. Step 6
makes it redundant and you can delete it then.

## 4. Two ideas worth stopping on

### Health is computed, not stored

`device-health.ts` stores only a timestamp. `online` or `offline` is worked out when
somebody asks.

Think about why storing a `status` field would be worse. A device going offline is
not an event. Nothing arrives to tell you about it. That is precisely what "offline"
means. To maintain a stored flag you would need a timer sweeping every device on a
schedule, and between sweeps your stored answer would be wrong.

Computing on read needs no timer and cannot be stale.

### A `Map`, not an object

Device ids arrive from the network. On a plain object, keys like `__proto__` and
`constructor` collide with JavaScript's prototype machinery. `Map` keys are inert.
Any time your keys come from outside your program, reach for `Map`.

## 5. Verify

```bash
npm run dev
npm run mock
```

Real output from a run:

```
[INFO] Subscribed to spectral/esp32/+/sensors/dht, spectral/esp32/+/health
[INFO] Stored 24C 59.3% from esp32-01, 1 device(s) tracked
[INFO] Heartbeat from esp32-01
[INFO] Stored 23.8C 60.2% from esp32-01, 1 device(s) tracked
[INFO] Snapshot {
  readings: [
    {
      deviceId: 'esp32-01',
      temperature: 23.6,
      humidity: 60.4,
      receivedAt: 2026-08-28T13:45:39.909Z
    }
  ],
  health: [
    {
      deviceId: 'esp32-01',
      status: 'online',
      lastSeenAt: 2026-08-28T13:45:39.909Z
    }
  ]
}
```

The `1 device(s) tracked` count stays at 1 no matter how many readings arrive, because
the store keeps the latest per device rather than a list. Start a second mock with a
different `MOCK_DEVICE_ID` and watch it become 2.

## 6. Watch a device go offline

This is the exercise for this step.

1. Start the server and the mock, and wait for a snapshot showing `status: 'online'`.
2. Stop the mock with Ctrl+C.
3. Wait through two more snapshots, roughly 30 seconds.

Real output from doing exactly that:

```
13:46:26  status: 'online',   lastSeenAt: 13:46:16
13:46:41  status: 'offline',  lastSeenAt: 13:46:16
```

Three things to notice.

**The reading did not disappear.** The store still holds 24.3C from 13:46:16. That is
correct behaviour: the last known temperature is still the last known temperature. A
dashboard should show it greyed out, not blank.

**`lastSeenAt` is identical in both snapshots.** Nothing changed in storage between
them. The only thing that changed is the current time, and the status was recalculated
against it. That is the computed-not-stored idea, visible.

**Nothing ran when the device went offline.** No timer fired, no event was handled, no
code executed at the moment it happened. The transition exists only as a different
answer to the same question. Sit with that one, it is the whole point.

Restart the mock and the next snapshot says `online` again, with no reconnection logic
anywhere in your code.

## 7. Restart the server

Stop it with Ctrl+C and start it again. The snapshot is empty until the next reading
arrives.

Everything in this step lives in RAM. That is fine for "what is the temperature right
now" and useless for "what was the temperature at 3am on Tuesday". Step 8 adds the
database that answers the second question, and the store stays exactly as it is,
because reading from memory is fast and reading from Postgres is not.

## What you now have

State that outlives a single message, health that answers correctly at any instant,
and an entry point you can read in one screen. Step 6 puts an HTTP API in front of
all three so a browser can ask.

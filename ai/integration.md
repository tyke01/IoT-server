# Integrating analysis into the server

How the techniques in [`README.md`](README.md) would attach to the existing code.
Nothing here is built yet. This is the design, at the level of detail where you could
sit down and write it.

Everything below follows the conventions the rest of the project already uses: plain
functions, explicit types, one folder per responsibility, and boundary types where
data crosses an edge.

---

## 1. Where it goes

```
src/
├── analysis/                    new
│   ├── README.md
│   ├── window.ts                recent readings per device
│   ├── detectors/
│   │   ├── threshold.ts         rung 0
│   │   ├── zscore.ts            rung 1
│   │   └── stuck-sensor.ts      rung 3
│   └── analysis-service.ts      runs the detectors, reports results
```

A sibling of `src/database/`, not a child of `src/services/`. It is its own
responsibility, and it should be removable without touching anything else.

The rule for the folder, in the style of the others: **`src/analysis/` must never
publish, store, or serve anything.** It takes readings and returns findings. Deciding
what to do with a finding belongs to `src/services/`.

---

## 2. One type, one interface

```ts
// src/types/analysis.ts

export type AnomalyKind =
  | "threshold-exceeded"
  | "statistical-outlier"
  | "rate-of-change"
  | "stuck-sensor"
  | "device-silent";

export type Severity = "info" | "warning" | "critical";

export interface Anomaly {
  deviceId: DeviceId;
  kind: AnomalyKind;
  severity: Severity;
  detectedAt: Date;
  metric: "temperature" | "humidity";
  value: number;
  expected: string;
  message: string;
}
```

A detector is a plain function:

```ts
export type Detector = (
  reading: TelemetryRecord,
  window: readonly TelemetryRecord[]
) => Anomaly | null;
```

Two arguments, one return, `null` for nothing found. No classes and no framework, the
same decision as `PublishFn` in step 7.

The payoff is that adding a detector is writing one function and adding it to an array.
It is also testable by calling it with an array of readings you made up, with no
broker, no database, and no server running.

`expected` as a string rather than a number is deliberate. Different detectors have
different notions of expected: a threshold has a limit, a z-score has a range, a stuck
sensor has "any change at all". A human-readable string is what ends up in an alert.

---

## 3. The window

Rung 1 needs the last N readings per device. Step 5's `telemetry-store.ts` keeps only
the latest, so this is a small extension rather than a new idea:

```ts
// src/analysis/window.ts

const WINDOW_SIZE = 50;
const windows = new Map<DeviceId, TelemetryRecord[]>();

export function pushReading(record: TelemetryRecord): void;
export function getWindow(deviceId: DeviceId): readonly TelemetryRecord[];
```

A ring buffer, oldest dropped when full.

**Memory cost, since embedded people ask and web people should:** 50 readings times
roughly 100 bytes per object is about 5KB per device. A hundred devices is half a
megabyte, which is nothing. Ten thousand devices is 50MB and starts to matter. The
number that breaks it is not the window size, it is the device count.

**Restart cost:** the window is empty and stays useless for the first two and a half
minutes. Either accept it, or warm the window from Postgres at startup, which is one
query per device and worth it if restarts are frequent.

---

## 4. Where it hooks in

In `message-handler.ts`, after the reading is stored:

```ts
saveLatest(record);
await saveReading(record);

const anomalies = analyseReading(record);   // new

for (const anomaly of anomalies) {
  await reportAnomaly(anomaly);
}
```

`analyseReading` is synchronous. Rungs 0 to 3 are arithmetic over an in-memory array
and take microseconds, so there is nothing to await and no reason to introduce
concurrency into a handler that already has ordering quirks from step 8.

Rung 4 changes this. ONNX inference is fast but not free, and it would become an
`await`, joining the same unbounded-concurrency situation described in step 8.

### Why after the write, not before

If analysis throws, the reading is already saved. A bug in a detector must never cost
you data. That ordering is deliberate and worth a comment in the code.

---

## 5. What happens to a finding

`reportAnomaly` lives in `src/services/`, because it decides things.

Four destinations, in the order I would add them:

**1. Log it.** One line, immediately, before anything else exists. Half the value for
none of the work.

**2. Store it.** A second table, so alerts can be reviewed and counted:

```prisma
model Anomaly {
  id         Int                  @id @default(autoincrement())
  deviceId   String
  kind       String
  severity   String
  metric     String
  value      Float
  message    String
  detectedAt TimestamptzString(3)

  @@map("anomalies")
}
```

Counting alerts per day is how you discover your thresholds are wrong. Without storage
you are guessing.

**3. Serve it.** `GET /api/anomalies?limit=100` and
`GET /api/anomalies/:deviceId`, mirroring the telemetry history endpoints exactly,
including the `parseLimit` validation.

**4. Publish it.** An alerts topic the dashboard can subscribe to:

```
spectral/esp32/{deviceId}/alerts
```

Note this is the server publishing on a device's topic namespace, which is a slight
departure from the current scheme where devices own their topics. An alternative is a
separate `spectral/alerts/{deviceId}` tree. Worth deciding deliberately rather than
drifting into.

---

## 6. Configuration

Detector parameters belong in `config/`, not scattered as constants:

```ts
analysis: {
  enabled: optionalBool("ANALYSIS_ENABLED", true),
  windowSize: optionalInt("ANALYSIS_WINDOW_SIZE", 50),
  zScoreThreshold: optionalFloat("ANALYSIS_Z_THRESHOLD", 3),
  temperatureMax: optionalFloat("ANALYSIS_TEMP_MAX", 35),
  stuckReadingCount: optionalInt("ANALYSIS_STUCK_COUNT", 20),
}
```

Two reasons beyond tidiness. Thresholds get tuned constantly in the first weeks, and
editing `.env` beats editing source. And `ANALYSIS_ENABLED=false` means a misbehaving
detector can be switched off in production without a deploy.

`config/env.ts` currently has `requireEnv`, `optionalEnv`, and `optionalPort`. This
needs numeric and boolean helpers, which is a natural extension of step 9's validation
work rather than a new pattern.

---

## 7. What this costs

Stated plainly, because every improvement in this project states its cost.

**Alert fatigue is the real risk.** A detector that fires ten times a day on a device
nobody is worried about trains people to ignore it. That is worse than no detector,
because it costs attention and provides false comfort. Budget for tuning, and count
your alerts.

**More state to reason about.** The window is another thing that is empty after a
restart and grows with device count.

**Detectors are code that can be wrong.** A z-score with a near-zero standard deviation
produces enormous values on a stable sensor, and the fix is a floor on the denominator
that you will only think to add after it fires at 2am.

**Rung 4 adds an artefact with a lifecycle.** A model file has a version, a training
date, and an expiry nobody writes down. That is ongoing operational work, and it is
why the ladder recommends exhausting rungs 0 to 3 first.

---

## 8. A build order

If you turn this into a step 10 and beyond, this order gives something useful at every
stage:

1. `Anomaly` type, `analysis-service.ts`, one threshold detector, log only.
2. The window, plus the z-score detector.
3. The stuck-sensor detector. Genuine value, four lines, catches a real failure.
4. Storage and the API endpoints.
5. Ground-truth testing, from the table in [`README.md`](README.md). **Do not skip
   this.** Everything before it is unmeasured.
6. Publishing to the alerts topic, and dashboard display.
7. Seasonal baselines, once there is enough history to compute one.

Rungs 4 and 5 come after all of that, if at all. By step 5 in this list you will have
numbers telling you whether they are needed, which is a better reason to build
something than curiosity.
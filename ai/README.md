# `ai/`

How machine learning fits into this server, what it can honestly do with the data you
have, and what it cannot.

This folder is documentation. Nothing here is wired into the running server yet, and
[`integration.md`](integration.md) describes exactly how it would be.

## Two different things called AI

This project touches both, and confusing them wastes everyone's time.

**AI reading your data.** Anomaly detection, forecasting, predictive maintenance.
Statistics and models applied to sensor readings. That is this folder.

**AI writing your code.** `CLAUDE.md`, agentic development, an assistant that
understands your repository. That is a separate entry in the improvements track and has
nothing to do with the contents of your `readings` table.

The first is built in [step 10](../docs/10-ai-agent.md), where an agent answers
questions about your readings using tools that query Postgres.

---

## Start here: you probably do not need a model

Before any of the rungs below, a blunt statement worth taking seriously.

A large share of production systems marketed as doing anomaly detection are running a
threshold and a bit of hysteresis. That is not a criticism of those systems. For "the
cold room went above 8 degrees", a threshold is correct, cheap, explainable to an
auditor, and cannot be wrong in a surprising way.

The ladder below exists because thresholds genuinely fail at some problems. It does
not exist because thresholds are unsophisticated. Rung 0 is a real rung, and if you
skip it you will have nothing to compare your model against.

---

## The ladder

Each rung solves a problem the one below it cannot. All of them run in the Node
server, in process.

| Rung | Technique | New dependencies |
|---|---|---|
| 0 | Thresholds and rules | none |
| 1 | Rolling statistics, z-score, EWMA | none |
| 2 | Seasonal baseline from stored history | none |
| 3 | Device health, the honest predictive maintenance | none |
| 4 | Trained model, run through ONNX | one |
| 5 | LLM for summarising alerts, never for detecting them | one |

---

### Rung 0: thresholds and rules

```
if temperature > 35 for 3 consecutive readings -> alert
```

**Solves:** known limits with a known correct answer.

**Cannot solve:** anything where "normal" depends on context. 28 degrees is fine at
2pm and strange at 3am. A threshold that catches the 3am case screams all afternoon.

**The part people skip:** the "for 3 consecutive readings" clause. Without it, a single
noisy reading at 35.1 fires an alert, and a sensor sitting at 34.9 fires and clears
repeatedly all day. Requiring persistence, and using a lower threshold to clear than
to trigger, is called hysteresis and it is the difference between an alerting system
people trust and one they mute.

---

### Rung 1: rolling statistics

Keep the last N readings per device. Compare each new reading to the mean and standard
deviation of that window.

```
z = (value - mean) / stddev
alert when |z| > 3
```

**Solves:** "unusual for this device recently", with no fixed limit and no training. A
device in a cold room and one in a boiler room each learn their own normal.

**Also solves rate-of-change.** Temperature rising 4 degrees in 9 seconds is physically
implausible indoors and is worth flagging even when the absolute value is fine. Often
more informative than the value itself.

**EWMA** (exponentially weighted moving average) is the same idea with a shorter
memory: recent readings weigh more, and it needs one number of state per device rather
than a window.

**Costs:**

- **Cold start.** Nothing can be said until the window fills. With a 3 second interval
  and a 50 reading window, that is two and a half minutes after every restart.
- **It learns bad behaviour.** A sensor that has been drifting for a week has a mean
  that drifted with it. The anomaly becomes the new normal, silently.
- **Standard deviation near zero.** A perfectly stable sensor gives a tiny stddev, so
  trivial noise produces enormous z-scores. Needs a floor on the denominator.

That last one is a real bug you will hit, not a theoretical concern.

---

### Rung 2: seasonal baseline

Rung 1 asks "is this unusual compared to five minutes ago". Rung 2 asks "is this
unusual for a Tuesday at 3am", using the history already in Postgres.

Group past readings by hour of day, take the expected range for this hour, compare.

**Solves:** the daily cycle that rung 1 mistakes for an anomaly at dawn and dusk every
single day.

**Costs:** needs weeks of history before the buckets mean anything, and a query per
check unless you cache the baseline. Recompute it nightly, not per reading.

---

### Rung 3: device health, the honest predictive maintenance

Predictive maintenance means learning the signature that precedes a failure. It needs
a thing that fails and a record of it failing.

**Your DHT22 has neither.** It sits on a desk. There is no bearing wearing out, no
motor drawing more current each week, and no log of past breakdowns to learn from. A
document claiming otherwise would be teaching you to point a technique at a problem
that is not there.

But something in your system does degrade, and you already store data about it: **the
sensor node itself.**

| Failure mode | Signal in your data |
|---|---|
| DHT22 stuck | Identical value repeated many times running |
| DHT22 failing | Read failures rising, `NaN` returns increasing |
| Sensor drift | Slow divergence from a second sensor in the same room |
| Failing power supply | Reboots, seen as uptime resetting or gaps in readings |
| Weak wifi | Reconnects, heartbeat gaps, growing jitter in arrival times |

A DHT22 returning exactly 24.1 for two hundred consecutive readings is broken, not
stable. That check is four lines and catches a real, common failure that every other
rung on this ladder would call perfectly normal.

**This is the rung to build first after rung 0.** It is genuine predictive
maintenance, on hardware the student is holding, and it needs no model.

#### What real predictive maintenance would need

So you know the technique is real and know exactly what is missing:

- **A failure mode.** Something that wears: a bearing, a belt, a pump.
- **Sensors that see it.** Vibration or current draw, sampled at hundreds or thousands
  of hertz. A reading every 3 seconds cannot see a bearing's signature.
- **Labelled failures.** Runs where the machine was allowed to fail, with the failure
  time recorded. This is the expensive part, which is why public run-to-failure
  datasets exist and are heavily used. Find one rather than trusting my recollection
  of its name.

Give a student vibration data at 20kHz with labelled failures and the modelling is the
easy part. Everything above is why industrial predictive maintenance is hard.

---

### Rung 4: a trained model

When the rungs above genuinely are not enough: multiple sensors whose relationship
matters more than any single value, where "normal" is a shape rather than a range.

**Approach that fits this server:** train offline, run in Node.

Training in Node is impractical and unnecessary. Export your history to CSV, train in
a Python notebook, export the model to ONNX, and load it with the ONNX runtime in the
server. Inference on a small model is well under a millisecond and needs no Python at
runtime.

Reasonable model choices for unlabelled sensor data: isolation forest, one-class SVM,
or a small autoencoder where reconstruction error is the anomaly score.

**Costs, and they are larger than they look:**

- **A model in production is a file with a version, a training date, and provenance.**
  It goes stale. Something has to retrain and redeploy it. This is more operational
  work than all the rungs above combined.
- **It cannot explain itself.** Rung 1 says "4.2 standard deviations above the mean of
  the last 50". A model says 0.87. Both may be correct and only one gets acted on.
- **You still need rungs 0 to 3 running,** because a model that fails silently is worse
  than no model, and the simple checks are how you notice.

---

### Rung 5: LLMs, and the line to draw

This is where most people currently get it wrong, so be precise.

**Bad use: asking a language model whether a reading is anomalous.** It is expensive
per reading, slow, non-deterministic, cannot be evaluated with precision and recall,
and is genuinely poor at spotting numeric outliers compared to a z-score that costs
nothing. Do not put a model call in the message handler.

**Good use: everything after detection.** The detectors produce structured facts. A
language model turns them into something a human acts on.

- Fourteen alerts across three devices become one paragraph explaining what appears to
  be happening.
- An alert plus the device's recent history becomes a drafted maintenance ticket.
- A technician asks "what happened in the cold room last night" and gets an answer
  assembled from real query results.

The pattern: **detection is arithmetic, explanation is language.** Keep the model out
of the loop that decides, and use it in the loop that communicates.

**Hard boundaries:**

- Never in the hot path. Detection runs per reading, an LLM call takes seconds and can
  fail.
- Never actuating. A language model must not decide to turn a relay on. Anything with
  a physical consequence goes through explicit code with explicit limits.
- Ground every number. If it reports a temperature, that number comes from a query
  result you passed in, not from the model.

---

## Evaluating any of this

The question that separates a demo from a system: **how do you know it works?**

Unsupervised anomaly detection has a trap. Without labelled anomalies you cannot
compute precision or recall, so you cannot tell a detector that catches everything
from one that fires constantly. Both look busy.

**Make your own ground truth.** This is the best exercise in this document, and your
sensor makes it easy:

| Action | Expected detection |
|---|---|
| Breathe on the DHT22 | Sharp rise in both values, rung 1 |
| Put it in a fridge for a minute | Sustained excursion, rungs 0 and 1 |
| Unplug the data pin | Read failures, then a gap, rung 3 |
| Hold the value by mocking a constant | Stuck sensor, rung 3 |
| Leave it alone for an hour | Nothing. **This is the important one.** |

Write down when you did each. Now you have labels, and you can count what was caught,
what was missed, and how many times it cried wolf on a quiet hour.

That last row deserves emphasis. A detector's false positive rate on ordinary data
matters more than its catch rate, because alerts nobody trusts get ignored, and an
ignored alerting system is worse than none: it costs money and provides false comfort.

---

## Other places AI fits in an IoT system

The ladder above is about one thing: judging whether a reading is normal. That is the
most common use, not the only one.

| Use case | What it does | Where it runs | Honest difficulty |
|---|---|---|---|
| **Natural-language querying** | "Was the lab warmer than usual last night?" answered from real rows | Server, on demand | Low. Built in [step 10](../docs/10-ai-agent.md) |
| **Alert triage and summarising** | Fourteen alerts become one sentence a technician can act on | Server, after detection | Low. Same technique as step 10 |
| **Anomaly detection** | Is this reading unusual | Server, per reading | Low to medium. The ladder above |
| **Device health prediction** | Stuck sensors, drift, reboot patterns | Server, per reading | Low. Rung 3, and the best value here |
| **Forecasting** | Where is this heading, and when does it cross a limit | Server, on demand | Low for trends, high for anything seasonal |
| **Adaptive sampling** | Publish every 30s when calm, every 2s when changing | Device | Medium. Saves battery and bandwidth, needs care not to miss events |
| **Sensor fusion** | Combine several imperfect sensors into one better estimate | Either | Medium. Kalman filters, not machine learning |
| **Edge inference** | A small model on the ESP32 deciding locally | Device, TFLite Micro | High. Worth it when the network is unreliable or the latency budget is milliseconds |
| **Vision inspection** | A camera judging whether a part is good | Separate service | High. Different sensors, different pipeline, real labelling effort |
| **Digital twin** | A simulation running alongside, compared against reality | Server | High. You need a model of the physical system first |
| **Energy optimisation** | Scheduling loads against price or generation | Server | Medium. Mostly an optimisation problem, not a learning one |

Two things worth pulling out of that table.

**Adaptive sampling is the most underrated entry.** A battery device publishing every
2 seconds when nothing is changing is wasting most of its life. Publishing on change,
with a slow heartbeat as a floor, can extend battery life dramatically and reduce
your database growth at the same time. It needs no model, only a threshold and some
thought about what counts as a change worth reporting.

**Sensor fusion is not machine learning and people keep assuming it is.** Combining a
fast, noisy sensor with a slow, accurate one is a Kalman filter, which is
well-understood mathematics with a right answer. Reaching for a neural network there
is choosing a harder tool that performs worse.

---

For how these apply in specific fields, with what you can honestly demonstrate on a
DHT22 in each, see [`sectors.md`](sectors.md). The short version of that document:
your sensor already computes vapour pressure deficit and dew point, both of which are
real decisions in agriculture and buildings, and neither needs a model.

---

## Where the code would go

See [`integration.md`](integration.md) for the folder layout, the detector interface,
where it hooks into the message handler, how alerts are stored and exposed, and what
it costs in memory.

The short version: a `src/analysis/` folder alongside `src/database/`, detectors as
plain functions matching one type, called from `message-handler.ts` after the reading
is stored. No classes, no new concepts, and the same shape as everything else in this
project.
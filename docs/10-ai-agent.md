# Step 10: An agent that answers questions about your data

**Written against:** `openai` 7.10.0, Node 24, any OpenAI-compatible provider.

**Goal:** ask "has the lab been warming up today?" in plain English and get an answer
built from real database rows, with a chart.

**Files added:** `src/agent/loop.ts`, `src/agent/tools.ts`, `src/agent/forecast.ts`,
`src/agent/system-prompt.ts`, `src/agent/openai-client.ts`, `src/agent/question.ts`,
`src/api/routes/agent.ts`, `src/types/agent.ts`

**Files changed:** `src/config/env.ts`, `src/api/server.ts`, `src/types/index.ts`,
`package.json`, `.env.example`

## 1. Get a free API key

Any provider speaking the OpenAI chat completions format works. As of this writing,
Google Gemini and Mistral state that no credit card is required, Groq offers roughly
30 requests per minute, and OpenRouter roughly 50 requests per day. **Check before
class**, because these change often and the model names change faster.

```bash
npm install openai
```

```
LLM_API_KEY=your-key
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=openai/gpt-oss-120b
AGENT_MAX_STEPS=8
```

### Do not trust that model name

**Check the provider's current model list before you start.** Model identifiers
expire faster than anything else in this project. Groq deprecated four model
families in roughly a year, and a decommissioned model returns a 400 with
`"code": "model_decommissioned"` that reads like a configuration error.

Worse, a provider's own quickstart page can still show a name that no longer works.
That is not hypothetical: it is exactly how this document's first version got a dead
model name into it.

So the workflow is: look up a current model that supports tool calling, put it in
`.env`, then confirm it:

```bash
npm run verify:llm
```

One request, and it tells you whether the key, base URL, model, and tool calling all
work before you touch the agent.

Other base URLs are listed in `.env.example`, including a local Ollama, which needs
no key at all and works offline.

Whatever model you choose must support tool calling. Not all free models do, and the
failure is confusing: the model describes calling a function instead of calling it.
`npm run verify:llm` catches exactly that case.

A pass looks like this, from a real run:

```
[INFO] Provider: https://api.groq.com/openai/v1
[INFO] Model:    openai/gpt-oss-120b
[INFO] Responded in 1307ms
[INFO] PASS: called 'get_latest_reading'
[INFO] Arguments: {"deviceId":"esp32-01"}
[INFO] Usage: { prompt_tokens: 145, completion_tokens: 61, total_tokens: 206, ... }
```

That token count is worth keeping. About 200 tokens per turn, and 2 to 4 turns per
question, so roughly 400 to 900 tokens for a full answer. Small enough that the
per-minute request limit will stop you long before any token budget does.

Leave `LLM_API_KEY` blank and everything else still works. Only `/api/agent/ask`
returns 503. An optional feature must never stop the server booting.

## 2. What an agent is

```
send the question and the tool list to the model
loop:
  the model replies
  did it ask for a tool?
    yes -> run it, append the result, go round again
    no  -> that is the answer, stop
```

Sixty lines in `loop.ts`. That is genuinely the whole idea.

No framework is used. LangGraph.js and Mastra are both real and both good at durable
execution, resumable workflows, memory, and tracing. None of those are problems you
have. A framework here would hide the loop, and the loop is the lesson.

## 3. The rule everything else follows from

**The model never produces a number.**

Ask a language model for an average and it will give you one. It will look right. You
cannot check it and neither can it.

So the model gets five functions, and it chooses which to call:

| Tool | Returns |
|---|---|
| `list_devices` | Devices, status, latest reading |
| `get_readings` | Stored readings, newest first |
| `get_statistics` | min, max, mean, standard deviation |
| `forecast` | Trend fit, plus an rSquared |
| `make_chart` | A chart spec the dashboard renders |

`forecast` is a least squares fit written in TypeScript. The model calls it. It does
not do the regression, and it cannot change the answer.

Everything a user reads traces back to a row in Postgres. The model's contribution is
deciding what to look up and how to phrase it, which is what language models are
good at.

## 4. Tool arguments are untrusted input

A model writes its arguments as text. They arrive malformed, wrongly typed, or naming
a device that does not exist.

Same treatment as an MQTT payload, for the same reason:

```ts
const object = asObject(args);
if (object === null) {
  return { ok: false, error: "arguments must be an object" };
}
```

Errors are returned rather than thrown, and they are written to be read by the model:

```ts
error: `no stored readings for device '${deviceId}'. Call list_devices to see valid ids.`
```

That second sentence usually makes the model recover on its own next turn. An error
message is a prompt.

## 5. Verify without spending a request

The agent takes a `ChatFn`, so you can hand it a fake model and test the loop with no
API key and no network. Same trick as `PublishFn` in step 7.

`scripts/verify-agent-loop.ts` scripts five scenarios. Real output:

**A tool that does not exist:**

```
steps: [{ tool: 'delete_everything', ok: false, summary: "no tool named 'delete_everything'" }]
answer: 'I could not do that.'
```

**Arguments that are not valid JSON:**

```
steps: [{ tool: 'get_readings', arguments: '{not json', ok: false,
          summary: 'arguments were not valid JSON' }]
```

**A model that never stops, with the cap set to 3:**

```
{ truncated: true, steps: 3,
  answer: 'I could not finish within the allowed number of steps. Try a narrower question.' }
```

In all three the request completes and the server stays up. That last one is the
important one: without the cap, a model that keeps calling tools would run until your
free tier is exhausted. The cap is the difference between a bug and a bill.

## 6. Verify the forecast maths

`scripts/verify-forecast.ts`, run against known inputs. Real output:

| Input | changePerHour | rSquared | predicted |
|---|---|---|---|
| Perfect line, +0.5C every 3s | 600 | 1 | 327.0 |
| Flat, 24C throughout | 0 | 1 | 24.0 |
| Noise, no trend | | **0.018** | **-40.18** |
| Two readings only | | | `null` |
| All at the same instant | | | `null` |

Sit with row three, because it is the most useful line in this step.

Given noise, the fit produces **minus forty degrees**. That is not a bug. It is what
extrapolating a straight line through noise correctly does, and any forecasting method
will produce something similarly absurd when the data does not support a trend.

What saves you is `rSquared: 0.018`. Nearly zero, meaning a straight line explains
almost none of the variation. The system prompt tells the model to report it and to
say the prediction is unreliable below about 0.5.

**A prediction without a confidence measure is not a prediction.** Students should
break this deliberately: leave the sensor alone so the readings are flat and noisy,
ask for a forecast, and watch a ridiculous number arrive with an honest warning
attached.

The first row is worth noticing too. A perfect trend of half a degree every three
seconds really is 600 degrees per hour, and extrapolating it half an hour gives 327.
The maths is right and the situation is nonsense. Linear extrapolation assumes the
trend continues, and over 30 minutes on a room, it does not.

## 7. Ask it something

```bash
curl -X POST http://localhost:3000/api/agent/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"which devices are online and what is the latest temperature?"}'
```

The response has four parts:

```json
{
  "question": "...",
  "answer": "esp32-01 is online at 24.1 C ...",
  "charts": [],
  "steps": [{ "tool": "list_devices", "arguments": "{}", "ok": true, "summary": "ok" }],
  "truncated": false
}
```

`steps` is there for you, not the dashboard. It shows which tools ran, with what
arguments, in what order. Without it, an agent is a paragraph you have to trust.

Questions worth trying:

- "what is the average temperature for esp32-01?"
- "plot the last hour of temperature"
- "is the temperature rising?"
- "will it be above 30 degrees in an hour?"
- "which device has the most variable humidity?"

Then try one it should refuse: **"what will the temperature be next Tuesday?"** A good
answer says the data does not support that. Watch whether yours does.

## 7b. The gap problem, found by running it

This one was discovered from a real response, and it is the most instructive failure
in the step.

Asked to plot the last 50 temperature readings, the agent produced a correct chart of
correct data, and the chart was still misleading. The timestamps:

```
09:16:24 ... 09:16:58     12 readings
        [80 minute gap]
10:37:00 ... 10:37:27     10 readings
        [22 minute gap]
10:59:41 ... 11:01:02     28 readings
```

Fifty readings spanning **1 hour 45 minutes**, of which about **2.4 minutes** is
actual sampling. The rest is server downtime between test runs.

Two separate bugs fell out of that.

### The chart drew a category axis

With `xKey: "time"` holding ISO strings, Recharts treats the axis as categories and
spaces every point evenly. An 80 minute outage and a 3 second interval render
identically.

The fix is to plot epoch milliseconds on a numeric time axis, so the spec now carries
both:

```json
{ "t": 1788520584755, "time": "2026-09-04T09:16:24.755Z", "temperature": 24.5 }
```

`xKey` is now `"t"`. Section 8 shows the axis configuration.

### The forecast fitted a line across the gaps

The same window fed `forecast`, which reported a slight decline with
`rSquared: 0.51`, just over the 0.5 threshold, so the model presented it as a real
trend.

It was not one. The mock resets its random walk to 24.0 on every restart, so the
"decline" was the 09:16 session sitting slightly above the 11:00 session. Three
disconnected samples of the same process, fitted as though they were one continuous
series.

**A statistic computed over discontinuous data is not wrong, it is meaningless**, and
`rSquared` cannot tell you that because it never sees the timestamps as anything but
x values.

### The fix: tools report their own coverage

`src/agent/coverage.ts` measures the gaps and every tool now returns a `coverage`
object alongside its data. Verified against the real timestamps above:

```
{
  spanMinutes: 104.6,
  sampledMinutes: 1.1,
  gapCount: 3,
  largestGapMinutes: 80,
  contiguous: false,
  note: 'These readings are NOT continuous: 3 gap(s), the largest 80 minutes...'
}
```

And rule 5 of the system prompt now requires the model to say so, and to distrust any
trend across a gap regardless of `rSquared`.

### The deeper cause

**Readings are fetched by count, not by time.** "The last 50" and "the last hour" are
different questions, and only the first is currently askable, because
`findRecentReadingsByDevice` takes a limit.

A proper fix is a `get_readings_in_range` tool over a `WHERE receivedAt BETWEEN`
query. That was deferred in step 8 because the Prisma 8 comparison syntax was not
verified, and this is what deferring it cost. Worth adding once you confirm the
syntax.

Meanwhile the coverage object makes the limitation visible instead of silent, which
is the next best thing.

### The lesson worth keeping

Both bugs produced output that looked entirely correct. A plausible chart, a
plausible forecast, an answer with real numbers from real rows, and no error
anywhere. Nothing in the grounding design catches this, because the model was
faithfully reporting what the tools told it.

**Grounding stops invented numbers. It does not stop meaningless ones.** The tools
have to know what makes their own results untrustworthy and say so.

## 7c. The agent described a chart it could not see

Found immediately after fixing 7b, on a contiguous run. The agent called `make_chart`
alone and answered:

> The temperature line is essentially flat, showing only minor, short-term
> fluctuations typical of an indoor DHT22 sensor.

True, as it happens. Also invented.

Look at what the loop sends back to the model:

```ts
content: JSON.stringify(result.ok ? result.data : { error: result.error })
```

The chart's readings live in `result.chart`, which goes to the user. `result.data`
was only:

```json
{ "created": true, "pointCount": 50, "coverage": {...}, "note": "..." }
```

**Not one temperature value.** The model described the shape of a line from the
phrase "indoor DHT22" and the general behaviour of rooms, and happened to be right.

### Why the earlier run looked fine

The gapped run in 7b called `make_chart` **and** `get_statistics`, so it had real
figures. This run called only `make_chart`. Same question, different path, and only
one of them was grounded.

That is the cost of non-determinism, and it is why `steps` is in the response. A
single passing test proves nothing about the next call.

### The fix

`make_chart` now returns a `plotted` object with the figures behind the picture. For
that exact chart:

```json
{ "first": 25.1, "last": 25.1, "min": 24.4, "max": 25.4, "mean": 24.88, "netChange": 0 }
```

Now "flat" is a claim supported by a 1.0 degree range and zero net change, rather
than a guess. Rule 3 of the system prompt was tightened to forbid characterising a
line as flat, rising, stable or noisy unless `plotted` supports it.

### The general rule

**A tool that produces output for the user must also produce a description for the
model.** Anything the model cannot see, it will fill in, and it will fill in
something plausible.

Note how this differs from 7b. There the tools told the truth and the truth was
misleading. Here the tool told the model nothing and the model improvised. Both
produced confident, correct-looking, ungrounded output, and neither triggered an
error.

Worth stating plainly, because it is the honest limit of this design: grounding
prevents invented **numbers**. It does not by itself prevent invented
**characterisations**. Closing that gap means every tool asking what its caller needs
in order to describe the result truthfully.

## 8. Rendering the charts

`make_chart` returns a spec, not an image:

```json
{
  "title": "Temperature, last hour",
  "type": "line",
  "xKey": "time",
  "series": [{ "key": "temperature", "label": "Temperature (C)" }],
  "data": [{ "time": "2026-09-04T12:00:00.000Z", "temperature": 24.1, "humidity": 60.4 }]
}
```

In the dashboard:

```tsx
<LineChart data={chart.data}>
  <XAxis
    dataKey={chart.xKey}          // "t", epoch milliseconds
    type="number"
    scale="time"
    domain={["dataMin", "dataMax"]}
    tickFormatter={(t) => new Date(t).toLocaleTimeString()}
  />
  <YAxis />
  <Tooltip labelFormatter={(t) => new Date(t).toLocaleString()} />
  {chart.series.map((s) => (
    <Line key={s.key} dataKey={s.key} name={s.label} dot={false} />
  ))}
</LineChart>
```

`type="number"` and `scale="time"` are not optional. Without them Recharts spaces
points evenly by index, and a gap in your data becomes invisible. Section 7b is what
that looks like when it goes wrong.

Server-side image rendering would need `node-canvas`, which means native compilation
and genuine pain on Windows. A spec is smaller, interactive, and you can read it to
check the agent picked sensible data.

## 9. Costs, plainly

**Latency.** Seconds. Several model round trips plus your queries. Fine for a
question, impossible in the message handler.

**Rate limits.** Thirty students on one free key will hit them. Give each student
their own.

**Non-determinism.** The same question can take different routes. This is why `steps`
is in the response.

**It can still be wrong.** Grounding every number in a tool result stops invented
figures. It does not stop the model misreading a correct result, or quietly answering
a slightly different question. Showing the working is what makes that catchable.

## 10. What not to do with this

Worth stating, because the temptation is real.

- **Do not put it in `message-handler.ts`.** One model call per reading is seconds of
  latency and a rate limit within a minute.
- **Do not let it actuate.** No tool that turns the LED on. Anything with a physical
  consequence goes through explicit code with explicit limits, and step 7's endpoint
  already exists for that.
- **Do not give it raw SQL.** The five typed tools are the boundary. A
  `run_query(sql)` tool would be easier to write and would hand an untrusted text
  generator direct access to your database.
- **Do not skip the step cap.** See section 5.

## What you now have

A working agent grounded in real data, with its reasoning visible, its arithmetic
deterministic, and hard limits on what it can do and how much it can spend.

For where this goes next, and the other places AI fits in an IoT system, see
[`ai/README.md`](../ai/README.md).
# `src/agent/`

A language model that can answer questions about your sensor data by calling
functions you wrote.

## Responsibility

Turn a question into tool calls, run them, and turn the results into a sentence.

## Must never

- **Produce a number.** Every figure in an answer comes from a tool result, which
  came from Postgres. The model chooses what to look up and how to phrase it. It does
  not do arithmetic on your behalf.
- **Reach the database directly.** No SQL, no query strings, no table names. It gets
  five functions with typed arguments.
- **Run during message handling.** An MQTT message must never trigger a model call.
  This runs only when a person asks a question.

## Files

| File | What it does |
|---|---|
| `loop.ts` | The agent loop. About sixty lines |
| `tools.ts` | The five tools, each validating its own arguments |
| `forecast.ts` | Least squares trend fit. Arithmetic, not a model |
| `coverage.ts` | Measures gaps in a set of readings, so tools can flag their own limits |
| `system-prompt.ts` | The rules the model is given |
| `openai-client.ts` | Converts our message type into the provider's format |
| `question.ts` | Validates the request body |

---

## What an agent actually is

Strip away the vocabulary and it is a loop:

```
send the question and the list of tools to the model
loop:
  the model replies
  did it ask to run a tool?
    yes -> run it, append the result, go round again
    no  -> that is the answer, stop
```

That is the whole idea. Everything else people build around agents is memory,
observability, retries, and orchestration, none of which change this loop.

No framework is used here on purpose. LangGraph.js and Mastra are both real and both
solve real problems: durable execution, resumable workflows, evaluation harnesses,
tracing. None of those problems exist in "tell me the average temperature". Adding a
framework now would hide the sixty lines that are the actual lesson.

The improvements track covers when to reach for one.

---

## The rule that matters most

**The model must never produce a number.**

Ask a language model what the average temperature was and it will tell you. The
number will look plausible. It may be right. You have no way to know, and neither
does it.

So `forecast.ts` is a least squares fit written in TypeScript. The model calls it. It
does not perform the regression itself, and it cannot alter the result.

Everything a user sees traces back to a row in Postgres:

```
question -> [model picks a tool] -> your code queries -> [model explains] -> answer
```

The model's job is choosing what to look up and how to say it. Both are things
language models are good at. Arithmetic on data they cannot see is not.

This is the same line `ai/README.md` draws for anomaly detection: detection is
arithmetic, explanation is language.

---

## The tools

| Tool | Returns |
|---|---|
| `list_devices` | Every known device, status, latest reading |
| `get_readings` | Stored readings for one device, newest first |
| `get_statistics` | min, max, mean, standard deviation |
| `forecast` | Trend fit with an rSquared describing how much to trust it |
| `make_chart` | A chart specification for the dashboard to render |

### Arguments are untrusted input

A model generates its tool arguments as text. They can be malformed, have the wrong
types, or name a device that does not exist.

So every tool starts the same way the DHT22 parser does:

```ts
const object = asObject(args);
if (object === null) {
  return { ok: false, error: "arguments must be an object" };
}
```

Errors are returned, not thrown. The model reads the error and can correct itself.
Verified: given `{not json` as arguments, the loop reports "arguments were not valid
JSON" back to the model and the request completes normally.

### Errors are written for the model to read

```ts
error: `no stored readings for device '${deviceId}'. Call list_devices to see valid ids.`
```

That second sentence is not decoration. The model reads it and usually recovers on
the next turn. An error message is a prompt.

### A tool must describe its output to the model

`make_chart` returns two different things to two different audiences. The `chart`
spec goes to the user. The `data` object goes into the conversation.

If `data` omits the figures, the model describes a picture it cannot see, and it will
do so confidently. That happened during development: asked to plot temperatures, the
agent called only `make_chart` and reported the line was "essentially flat" without
having received a single value.

So `data` now carries a `plotted` summary: first, last, min, max, mean and net change
per series. The rule generalises: **anything the model cannot see, it will fill in.**

### `make_chart` returns a description, not a picture

The tool returns a `ChartSpec`: title, type, series, and data points. The loop
collects specs and the API returns them alongside the answer, and your dashboard
renders them with Recharts.

Server-side image rendering would need `node-canvas`, which means native compilation
and real pain on Windows. A spec is also inspectable, interactive, and far smaller
than a PNG.

---

## Tools report their own trustworthiness

Every tool returns a `coverage` object beside its data:

```
{ spanMinutes: 104.6, sampledMinutes: 1.1, gapCount: 3,
  largestGapMinutes: 80, contiguous: false, note: "..." }
```

Readings are fetched by count, not by time, so "the last 50" can span hours if the
server was restarted. A trend fitted across those gaps is meaningless, and `rSquared`
cannot detect it because the fit never sees timestamps as anything but x values.

This closes a hole that grounding alone does not. Grounding stops the model inventing
numbers. It does not stop the model faithfully reporting a number that should never
have been computed. **A tool has to know what makes its own result untrustworthy.**

Found by running it, not by reasoning about it. Step 10's section 7b has the case.

---

## The safety properties, and how they were verified

Each was tested with a scripted fake model, no API key involved.

| Property | Behaviour |
|---|---|
| Model asks for a tool that does not exist | Error returned to the model, request completes |
| Arguments are not valid JSON | Error returned to the model, request completes |
| A tool throws | Caught, logged, reported as a failure to the model |
| Model never stops calling tools | Stops at `AGENT_MAX_STEPS`, returns `truncated: true` |
| Provider unreachable | Route answers 502, not a crash |
| No API key configured | Route answers 503, rest of the server runs normally |

That fourth one deserves attention. A model that keeps calling tools without
concluding would otherwise loop until your free tier is exhausted. The cap is the
difference between a bug and a bill.

The fake-model technique is worth learning independently of agents. `askAgent` takes a
`ChatFn`, so a test supplies a function returning scripted turns. Same pattern as
`PublishFn` in step 7: depend on a capability, not an implementation, and testing
becomes possible.

---

## Providers

The code targets the OpenAI-compatible chat completions API, which Groq, Google
Gemini, Mistral, OpenRouter and a local Ollama all speak. Switching provider is three
environment variables:

```
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=...
LLM_MODEL=openai/gpt-oss-120b
```

Model names expire. Confirm yours with `npm run verify:llm` rather than assuming a
name from a tutorial still resolves; a decommissioned model returns a 400 that reads
like a configuration mistake.

That indirection is deliberate. Free tiers, rate limits, and model names change
often, so the thing most likely to break should be configuration rather than code.

`openai-client.ts` converts our `ChatMessage` type into the provider's wire format.
The fifth boundary in this project, and the same reasoning as the other four: what we
hold and what we send are different types, converted in one place.

If `LLM_API_KEY` is blank, the server starts normally and only `/api/agent/ask`
returns 503. An optional feature must not be able to prevent the server from booting.

---

## Costs

**Latency.** Seconds, not milliseconds. Several model round trips plus your queries.
Fine for a question, impossible in a message handler.

**Rate limits.** Free tiers are measured in requests per minute or per day. A
classroom of thirty students on one key will hit them. Give each student their own,
or expect queuing.

**Non-determinism.** The same question can produce different tool calls. Sometimes
this is fine and sometimes it is maddening, and it is why the API response includes
the steps it took.

**It can still be wrong.** Grounding every number in a tool result removes invented
figures. It does not stop the model misreading a correct result, or answering a
question slightly different from the one asked. Showing the steps is what makes that
checkable.

---

## Changed at

Step 10 (created).
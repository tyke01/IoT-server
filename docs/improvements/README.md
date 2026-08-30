# Improvements

Read these after step 9, not before.

Every item here was deliberately left out of the core build. That is not an oversight.
Each one solves a problem, and a solution to a problem you have not felt yet is just
complexity you cannot evaluate. Build the simple version, run into the wall, then come
here.

Each document follows the same shape:

1. **The problem**, described as something you will have actually experienced
2. **Why the current code hurts**
3. **The change**
4. **What it costs**, because every one of these costs something

## Infrastructure

| Improvement | Solves |
|---|---|
| [Docker and Docker Compose](01-docker.md) | "Works on my laptop", Postgres setup drift, deployment |
| Deploying to a VPS | Running when your laptop is closed |
| Environment separation | Dev and production sharing a database |

## Architecture

| Improvement | Solves |
|---|---|
| Polling to SSE, then WebSocket | Dashboard 3 seconds behind, wasted requests |
| Runtime validation with zod | A malformed payload crashing the server, and why types alone cannot stop it |
| JSON sensor catalogue | Editing four files to add one sensor |
| Functions to classes with dependency injection | Untestable code and hidden global state |
| Command acknowledgements | Not knowing whether the LED actually turned on |

## Data

| Improvement | Solves |
|---|---|
| Device table and relations | `deviceId` as a bare string with no validation |
| Indexing and batched writes | A write per reading, and slow history queries |
| Time-series storage | Millions of rows and aggregate queries |

## Operations

| Improvement | Solves |
|---|---|
| API keys, then real auth | Anyone who finds the URL can control your LED |
| Structured logging | Grepping console output at 2am |
| Automated tests | Fear of changing working code |

## Working with AI

| Improvement | Solves |
|---|---|
| `CLAUDE.md` and agentic development | An AI agent that does not know your conventions and invents its own |

That last one is worth a note. The folder READMEs in this project are not only for
you. A repository that explains its own structure is one an agent can work in
without guessing, and the same properties that make a codebase readable to a new
student make it legible to a model. The document covers what belongs in a
`CLAUDE.md`, what belongs in folder READMEs instead, and why "just let the AI read
the code" produces worse results than telling it the rules up front.

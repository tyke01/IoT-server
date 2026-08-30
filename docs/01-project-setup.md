# Step 1: Project setup

**Goal:** a TypeScript project that runs, reads configuration from a file, and
refuses to start if that configuration is incomplete.

**Files added:** `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`,
`src/index.ts`, `src/config/env.ts`, `src/utils/logger.ts`

## 1. Create the project

```bash
mkdir iot-server-student
cd iot-server-student
npm init -y
```

## 2. Install

```bash
npm install mqtt dotenv
npm install --save-dev typescript tsx @types/node
```

| Package | Why |
|---|---|
| `mqtt` | The MQTT client. Used properly in step 2 |
| `dotenv` | Loads `.env` into `process.env` |
| `typescript` | The compiler and the type checker |
| `tsx` | Runs TypeScript directly, no build step during development |
| `@types/node` | Type definitions for Node's own APIs like `process` and `Buffer` |

`@types/node` is worth pausing on. Node is written in JavaScript and ships no type
information. `@types/node` is a separate package of type declarations maintained by
the community. Without it, TypeScript does not know `process` exists. Many JavaScript
libraries work this way, which is why you sometimes install a second `@types/...`
package alongside the real one. Libraries that ship their own types, like `mqtt`,
do not need one.

## 3. `package.json`

Set `"type": "module"` and add the scripts. `"type": "module"` tells Node to treat
`.js` files as ES modules, which is why we write `import` rather than `require`.

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/src/index.js",
    "typecheck": "tsc --noEmit",
    "mock": "tsx scripts/mock-device.ts"
  }
}
```

`npm run dev` restarts on every save. `npm run typecheck` checks types without
producing output, which is what you run before committing.

## 4. `tsconfig.json`

The settings that matter, and why:

| Option | Effect |
|---|---|
| `"strict": true` | Turns on all the checks. Non-negotiable. Without it, TypeScript lets `undefined` slip through and you get JavaScript with extra steps |
| `"module": "NodeNext"` | Matches how Node actually resolves ES modules |
| `"noUncheckedIndexedAccess": true` | `array[0]` is typed as possibly `undefined`, because it is |
| `"verbatimModuleSyntax": true` | Forces `import type` for type-only imports, which makes what is erased at runtime obvious |
| `"outDir": "dist"` | Compiled output goes here, never committed |

Because `include` covers both `src/` and `scripts/`, the common root is the project
root, so compiled output lands in `dist/src/index.js`. That is why the `start` script
points there.

## 5. The `.js` extension rule

This confuses everyone once:

```ts
import { config } from "../config/env.js";   // correct
import { config } from "../config/env";      // fails at runtime
```

The file on disk is `env.ts`, but you import it as `env.js`. TypeScript does not
rewrite import paths. It compiles `env.ts` into `env.js` and leaves your import
string exactly as written, so the path must refer to the file that will exist after
compilation. Write `.js`, always.

## 6. Environment variables

Create `.env.example` with placeholder values and commit it. Copy it to `.env`, fill
in real credentials, and never commit that one. `.gitignore` already covers it.

```bash
cp .env.example .env
```

The reason this is not optional: credentials in source code end up on GitHub, and
broker credentials on GitHub end up in someone else's botnet. `.env.example`
documents which variables exist without leaking their values.

## 7. Verify

```bash
npm run dev
```

Expected, with `.env` filled in:

```
2026-08-28T09:12:44.001Z [INFO] Starting IoT server
```

Expected with a variable missing, which is the more interesting test:

```
Error: Missing required environment variable: MQTT_PASSWORD.
Copy .env.example to .env and fill it in.
```

Delete a line from your `.env` and confirm you get that. A server that fails loudly
at startup is worth more than one that starts and misbehaves quietly.

## What you now have

A project that runs, reads its configuration from one place, checks that
configuration, and logs in a consistent format. No IoT yet. That is step 2.

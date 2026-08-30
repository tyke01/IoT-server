# `src/utils/`

## Responsibility

Small helpers with no business meaning. If a function would make sense in a
completely different project, it belongs here.

## Must never

Become the folder where things go when you cannot decide. `utils/` with twenty
unrelated files is a symptom, not a folder. If a helper is about devices, it goes
in `devices/`.

## Files

| File | What it does |
|---|---|
| `logger.ts` | Timestamped, level-tagged console output |

## Why wrap `console.log`?

`console.log` is fine until you have three of them and no idea which fired first,
or you deploy and want to filter for errors only. The wrapper gives every line a
timestamp and a level, in one consistent format, from one place. When you later
swap in a real logging library, you change one file instead of forty call sites.

That last sentence is the actual argument. Not "logging is good practice" but
"you will want to change this later and this makes it a one-file change."

## The `LogLevel` type

```ts
type LogLevel = "info" | "warn" | "error";
```

This is a **union of string literal types**. `LogLevel` is not "any string", it is
one of exactly those three. `write("debug", ...)` fails to compile. You get
autocomplete, and a typo is a build error rather than a runtime surprise.

Step 3 covers this in depth. It appears here because the logger needed it first.

## Changed at

Step 1 (created), step 9 (structured logging).

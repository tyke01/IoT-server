# `src/config/`

## Responsibility

Read settings from the environment, check that the required ones are present,
and hand the rest of the program one plain object to import.

## Must never

- Contain a hardcoded password, URL, or hostname.
- Be imported by anything that then re-reads `process.env` itself. There is one
  door into configuration and this is it.

## Files

| File | What it does |
|---|---|
| `env.ts` | Loads `.env`, validates, exports the `config` object |

## Why not just use `process.env` everywhere?

Three reasons, all of which you will feel by step 6.

1. **`process.env.ANYTHING` is typed as `string | undefined`.** TypeScript forces
   you to handle the undefined case at every single use site. Doing it once here
   means everywhere else gets a plain `string`.
2. **Typos fail silently.** `process.env.MQTT_URI` when the variable is `MQTT_URL`
   gives you `undefined`, not an error. Here, `requireEnv` throws by name.
3. **It fails at the right time.** A missing variable crashes the server on the
   first line of startup with a clear message, not twenty minutes later when a
   publish quietly goes nowhere.

## The two helpers

`requireEnv(name)` throws if the variable is missing or blank. Use it for anything
the server genuinely cannot run without: broker URL, username, password.

`optionalEnv(name, fallback)` returns a default instead. Use it for anything with
a sensible default: the base topic, the client id.

Deciding which helper a variable gets is a design decision, not a formality. If you
find yourself giving a password a fallback, stop.

## The shape

```ts
config.mqtt.url
config.mqtt.username
config.mqtt.password
config.mqtt.clientId
config.mqtt.baseTopic
```

Grouping by concern (`config.mqtt.*`, later `config.database.*`, `config.http.*`)
keeps the object readable as it grows. A flat object with fourteen keys is a mess
at step 9.

## About the client id

Every MQTT connection needs an id that is unique on that broker. If two clients
connect with the same id, the broker kicks the first one off, and you get a server
that connects and drops in a loop for no visible reason. That is why the default is
random. On a shared class broker, this bug is common and confusing, so it is worth
knowing about before it happens to you.

## Changed at

Step 1 (created), step 8 (database URL), step 9 (proper validation).

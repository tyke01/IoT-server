# `src/mqtt/`

## Responsibility

Own the connection to the broker. Connect, reconnect, subscribe, publish,
disconnect cleanly.

## Must never

Know what a DHT22 is, what an LED is, or what temperature means. This folder moves
strings between the broker and the rest of the program. The moment you write
`JSON.parse` in here, the folder has taken on a second job and you will regret it
when you add a second sensor.

That rule is the whole point of splitting `mqtt/` from `devices/`. Transport in one
place, meaning in another.

## Files

| File | What it does |
|---|---|
| `client.ts` | Connect, subscribe, register a message handler, disconnect |

## The exported functions

`connectToBroker()` builds the client and attaches the lifecycle listeners
(`connect`, `reconnect`, `close`, `error`). It returns immediately, before the
connection is established. MQTT is asynchronous, and the library queues anything
you publish before the handshake finishes.

`subscribe(client, topics)` subscribes to a list of topics it is handed. It does not
choose them. `index.ts` builds the list from `devices/topics.ts`, which is the only
place that knows a DHT topic from a health topic.

`onMessage(client, handler)` registers your callback. The raw payload arrives as a
`Buffer` (a chunk of bytes), and `.toString()` turns it into text. Everything on
MQTT is bytes; JSON is a convention we layered on top, not something the protocol
knows about.

`publish(client, topic, payload)` sends a message at QoS 1 and resolves when the
broker acknowledges it. Added at step 7. Note what resolving means: the broker has
it. Whether any device received it is unknowable from here, which is why the API
answers 202 rather than 200.

`disconnect(client)` wraps the callback-based `client.end()` in a Promise so the
shutdown code in `index.ts` can `await` it.

## Wildcards

| Symbol | Matches | Example |
|---|---|---|
| `+` | exactly one level | `spectral/esp32/+/health` matches every device's health |
| `#` | this level and all below, must be last | `spectral/esp32/#` matches everything |

`#` is fine while you are exploring. In production it means you receive traffic you
did not ask for and cannot control, which costs bandwidth and hides bugs.

## QoS, briefly

We subscribe at QoS 1: the broker keeps re-sending until we acknowledge, so a
message arrives at least once, possibly twice. QoS 0 is fire and forget. QoS 2 is
exactly once and much more expensive. For sensor readings every 3 seconds, 0 or 1
are both defensible. Duplicate handling appears in the improvements track.

## Changed at

Step 2 (created), step 4 (subscribe takes a topic list), step 7 (`publish`).
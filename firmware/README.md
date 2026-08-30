# `firmware/`

The ESP32 side of this project. Reads a DHT22, publishes it, listens for LED
commands, and does nothing else.

It lives in the same repository as the server on purpose. The contract between the
two is a set of topic strings and a payload shape, and a contract with its two halves
in different repositories drifts.

## Contents

| File | What it is |
|---|---|
| `platformio.ini` | Board, framework, libraries |
| `src/main.cpp` | The whole sketch |
| `include/secrets.h.example` | Credentials template. Copy to `secrets.h` |

## Hardware

| Part | Pin | Note |
|---|---|---|
| DHT22 data | GPIO 4 | 10k pull-up to 3.3V if your module has no built-in resistor |
| LED | GPIO 2 | The onboard LED on most dev boards, so no wiring needed |

If you have no DHT22, uncomment the `build_flags` line in `platformio.ini` and skip
the sensor entirely. The LED half still works on the onboard pin, so nobody is
excluded from the full loop.

## First run

```bash
cp include/secrets.h.example include/secrets.h
```

Fill it in, then upload. `secrets.h` is gitignored, for the same reason `.env` is on
the server side: credentials in source control end up on GitHub, and broker
credentials on GitHub end up in someone else's botnet.

Expected serial output at 115200 baud:

```
Joining wifi network my-network
....
Connected, address 192.168.1.42
Connecting to broker... connected
Subscribed to spectral/esp32/esp32-01/commands/led
Published {"temperature":24.1,"humidity":60.4}
```

---

## The functions

Each one has a single job, and the file reads in the order things happen.

| Function | Purpose |
|---|---|
| `buildTopics()` | Assemble the three topic strings once, at startup |
| `setLed(bool)` | Drive the LED pin |
| `connectWifi()` | Join the network, block until it succeeds |
| `onMqttMessage(...)` | Handle an incoming LED command |
| `connectMqtt()` | One connection attempt, subscribe, report success |
| `readSensor(float*, float*)` | One reading, real or mocked |
| `publishReading(...)` | Build the JSON and publish it |
| `publishHeartbeat()` | Publish `alive` |
| `setup()` | Wire everything up |
| `loop()` | Timers, and service the MQTT connection |

---

## The five things worth understanding

### 1. No `delay()` in `loop()`

This is the most important rule in the sketch, and breaking it is the most common
ESP32 MQTT bug there is.

```cpp
if (now - lastReadingAt >= READING_INTERVAL_MS) {
  lastReadingAt = now;
  ...
}
```

The obvious way to publish every three seconds is `delay(3000)`. Do that and MQTT
stops working, because `mqtt.loop()` is what receives messages, answers the broker's
keepalive pings, and fires your callback. While `delay()` blocks, none of that
happens. Your LED commands arrive three seconds late, or not at all, and the broker
eventually decides you are gone.

So `loop()` runs continuously and each periodic job checks whether its own interval
has elapsed. `millis()` returns milliseconds since boot, and subtracting two of them
gives elapsed time.

Subtracting is also why `millis()` overflowing after about 49 days does not matter
here. `now - lastReadingAt` stays correct across the wrap because both are unsigned
and the arithmetic wraps with them. Writing `now >= lastReadingAt + interval` would
break. This is worth knowing and worth not being clever about.

### 2. The callback payload is not a string

```cpp
void onMqttMessage(char *topic, byte *payload, unsigned int length) {
  char command[8] = {0};
  memcpy(command, payload, length);
  command[length] = '\0';
```

PubSubClient hands you a pointer and a length. The bytes are **not** null-terminated,
and they point into a buffer that gets reused.

Treat that pointer as a C string and you will read past the end of your message into
whatever the previous message left behind. Sometimes it works. Sometimes `strcmp`
against `"ON"` matches when the payload was `"OFF"` followed by stale bytes. It is a
genuinely nasty bug because it is intermittent.

Copying into a local buffer and terminating it yourself costs three lines.

The length check before the copy matters too. Without it, a long payload overflows
`command` and corrupts the stack, which is how a device starts rebooting for reasons
that appear unrelated to networking.

### 3. Reconnection does not loop

Most PubSubClient examples do this:

```cpp
while (!client.connected()) {   // do not copy this
  client.connect(...);
  delay(5000);
}
```

That blocks everything until the broker comes back. This sketch instead returns from
`loop()` and tries again on the next pass once the interval has elapsed:

```cpp
if (!mqtt.connected()) {
  if (now - lastReconnectAt >= RECONNECT_INTERVAL_MS) {
    lastReconnectAt = now;
    connectMqtt();
  }
  return;
}
```

`connectMqtt()` makes exactly one attempt and reports whether it worked. Deciding when
to try again is `loop()`'s job. One function, one purpose.

### 4. No JSON library

```cpp
snprintf(payload, sizeof(payload),
         "{\"temperature\":%.1f,\"humidity\":%.1f}", temperature, humidity);
```

Verified output: `{"temperature":24.0,"humidity":60.4}`, 36 bytes, and 38 bytes at the
extremes of `-10.0` and `100.0`.

ArduinoJson is a good library and this does not need it. Two floats into a fixed
format string is one line, uses no heap, and cannot fail in a way you have to handle.
Adding a library to concatenate two numbers teaches the wrong instinct.

The moment payloads gain nested objects, arrays, or optional fields, that changes.
ArduinoJson is in the improvements section with that reasoning.

Note `%.1f` also decides your precision. The DHT22 does not resolve better than 0.1
degrees, so sending more digits would be inventing information.

### 5. No `String`

Every buffer in this sketch is a fixed `char` array. The Arduino `String` class works,
and on a device with 320KB of RAM running for weeks, repeated allocation and
concatenation fragments the heap until an allocation fails at three in the morning.

Fixed buffers are allocated once and cannot fragment. The cost is that you must think
about size, which is a good habit rather than a burden. `char telemetryTopic[96]`
holds `spectral/esp32/esp32-01/sensors/dht` with room to spare, and `snprintf` cannot
overflow it because it takes the size.

---

## `USE_MOCK_SENSOR`

```cpp
#ifdef USE_MOCK_SENSOR
  // random walk between 18 and 34 degrees
#else
  float t = dht.readTemperature();
#endif
```

The flag changes what `readSensor()` returns and nothing else. Topics, payload format,
publish timing, and the LED path are all identical.

That is the same point step 2 made about `scripts/mock-device.ts`: the contract is the
topic and the payload shape, not the hardware. Run the mock firmware and the server
cannot tell the difference, because there is no difference to tell.

Uncomment in `platformio.ini`:

```ini
build_flags = -DUSE_MOCK_SENSOR
```

A compile-time flag rather than a runtime setting, because the mock should not be
present in firmware you would put on a real device.

---

## TLS, and what `setInsecure()` gives up

```cpp
secureClient.setInsecure();
```

This is a real compromise and the document is not going to hide it.

TLS does two things: it encrypts the connection, and it verifies that the server on
the other end is who it claims to be. `setInsecure()` keeps the first and abandons the
second. Your traffic is still encrypted. But the ESP32 will accept a certificate from
anybody, so an attacker positioned between your device and HiveMQ can present their
own certificate, and your device will hand over your broker username and password
without complaint.

On a classroom network, this is an acceptable trade for not spending a lesson on
certificate handling. On anything real, it is not, and shipping a product like this
would be a serious defect.

Doing it properly means embedding the root CA certificate and calling
`secureClient.setCACert(...)`. That brings its own problem, which is what happens when
the certificate expires and your devices are on somebody's roof. Both halves are in
the improvements section, because the second half is the part people forget.

---

## What the server sees

| Topic | Payload | When |
|---|---|---|
| `spectral/esp32/{DEVICE_ID}/sensors/dht` | `{"temperature":24.1,"humidity":60.4}` | every 3s |
| `spectral/esp32/{DEVICE_ID}/health` | `alive` | every 5s |
| `spectral/esp32/{DEVICE_ID}/commands/led` | `ON` or `OFF` | subscribed |

`DEVICE_ID` comes from `secrets.h` and is used for both the topic and the MQTT client
id. On a shared class broker, two students with the same value will disconnect each
other in a loop, so set your own.

---

## Improvements

Same idea as the server's improvements track: each of these solves a problem you will
have felt first.

| Improvement | Solves |
|---|---|
| Split into `lib/` modules | One file doing wifi, MQTT, sensor, and LED |
| Proper root CA, and cert rotation | `setInsecure()` accepting any certificate |
| ArduinoJson | Payloads with nesting or optional fields |
| Command acknowledgements | The server not knowing if the LED changed |
| Deep sleep between readings | Battery life, if the device is not mains powered |
| OTA updates | Devices you cannot reach with a cable |
| AsyncMqttClient or `esp-mqtt` | A slow broker stalling the main loop |
| Last Will and Testament | The broker announcing your death instead of a 15s timeout |

### On splitting into `lib/`

The natural split is `lib/wifiConnection/`, `lib/mqttConnection/`, `lib/dhtSensor/`,
`lib/ledOutput/`, each with a matching header and source file.

Do it once `main.cpp` gets uncomfortable, not before. At 200 lines with nine
functions, one file is easier to read than four. The argument for splitting is that
you cannot test or reuse a function that lives in a sketch, and the moment you want
the same wifi logic in a second project, the copy-paste is the signal.

### On Last Will and Testament

Worth knowing about now even if you implement it later. MQTT lets you register a
message the broker publishes on your behalf if you disappear without saying goodbye.
Set it to publish `offline` on the health topic, and the server learns about a dead
device from the broker rather than waiting out the 15 second timeout in
`device-health.ts`.

That would let the server stop computing status from a timestamp, which is a real
architectural change and the reason it is an improvement rather than a detail.

---

## A note on verification

The sketch has been syntax and type checked with `g++ -Wall -Wextra` against stub
headers, and the payload formatting was compiled and run to confirm the exact bytes
and lengths quoted above. It has **not** been compiled with the ESP32 toolchain or
flashed to a board. Build it before teaching from it.
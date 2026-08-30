#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>

#include "secrets.h"

// ---------------------------------------------------------------- settings

#define BASE_TOPIC "spectral/esp32"

#define DHT_PIN 4
#define DHT_SENSOR_TYPE DHT22
#define LED_PIN 2

static const unsigned long READING_INTERVAL_MS = 3000;
static const unsigned long HEARTBEAT_INTERVAL_MS = 5000;
static const unsigned long RECONNECT_INTERVAL_MS = 5000;

// PubSubClient defaults to 256 bytes and silently drops anything larger.
static const uint16_t MQTT_BUFFER_BYTES = 512;

// ------------------------------------------------------------------ state

WiFiClientSecure secureClient;
PubSubClient mqtt(secureClient);
DHT dht(DHT_PIN, DHT_SENSOR_TYPE);

char telemetryTopic[96];
char healthTopic[96];
char commandTopic[96];

unsigned long lastReadingAt = 0;
unsigned long lastHeartbeatAt = 0;
unsigned long lastReconnectAt = 0;

// -------------------------------------------------------------- functions

/** Assemble the three topic strings once, at startup. */
void buildTopics() {
  snprintf(telemetryTopic, sizeof(telemetryTopic),
           BASE_TOPIC "/%s/sensors/dht", DEVICE_ID);
  snprintf(healthTopic, sizeof(healthTopic),
           BASE_TOPIC "/%s/health", DEVICE_ID);
  snprintf(commandTopic, sizeof(commandTopic),
           BASE_TOPIC "/%s/commands/led", DEVICE_ID);
}

void setLed(bool on) {
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}

/** Blocks until the network is joined. Nothing else can work without it. */
void connectWifi() {
  Serial.printf("Joining wifi network %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.printf("\nConnected, address %s\n", WiFi.localIP().toString().c_str());
}

/**
 * Called by PubSubClient when a message arrives.
 * payload is NOT null-terminated, so it cannot be treated as a C string.
 */
void onMqttMessage(char *topic, byte *payload, unsigned int length) {
  char command[8] = {0};

  if (length >= sizeof(command)) {
    Serial.printf("Command on %s too long (%u bytes), ignored\n", topic, length);
    return;
  }

  memcpy(command, payload, length);
  command[length] = '\0';

  Serial.printf("Command on %s: %s\n", topic, command);

  if (strcmp(command, "ON") == 0) {
    setLed(true);
  } else if (strcmp(command, "OFF") == 0) {
    setLed(false);
  } else {
    Serial.printf("Unknown command: %s\n", command);
  }
}

/** One connection attempt. Returns whether it worked. Never loops. */
bool connectMqtt() {
  Serial.print("Connecting to broker... ");

  if (!mqtt.connect(DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD)) {
    Serial.printf("failed, state %d\n", mqtt.state());
    return false;
  }

  Serial.println("connected");
  mqtt.subscribe(commandTopic, 1);
  Serial.printf("Subscribed to %s\n", commandTopic);
  return true;
}

/**
 * Fills temperature and humidity. Returns false if the sensor did not answer.
 * With USE_MOCK_SENSOR defined, generates plausible values instead.
 */
bool readSensor(float *temperature, float *humidity) {
#ifdef USE_MOCK_SENSOR
  static float mockTemperature = 24.0f;
  static float mockHumidity = 60.0f;

  mockTemperature += (random(-6, 7) / 10.0f);
  mockHumidity += (random(-20, 21) / 10.0f);

  mockTemperature = constrain(mockTemperature, 18.0f, 34.0f);
  mockHumidity = constrain(mockHumidity, 30.0f, 90.0f);

  *temperature = mockTemperature;
  *humidity = mockHumidity;
  return true;
#else
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if (isnan(t) || isnan(h)) {
    return false;
  }

  *temperature = t;
  *humidity = h;
  return true;
#endif
}

void publishReading(float temperature, float humidity) {
  char payload[64];
  snprintf(payload, sizeof(payload),
           "{\"temperature\":%.1f,\"humidity\":%.1f}", temperature, humidity);

  if (mqtt.publish(telemetryTopic, payload)) {
    Serial.printf("Published %s\n", payload);
  } else {
    Serial.println("Publish failed");
  }
}

void publishHeartbeat() {
  mqtt.publish(healthTopic, "alive");
}

// ------------------------------------------------------------ setup / loop

void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(LED_PIN, OUTPUT);
  setLed(false);

  dht.begin();
  buildTopics();

  connectWifi();

  // Skips certificate verification. Fine for a classroom, not for anything
  // real. See the README.
  secureClient.setInsecure();

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(MQTT_BUFFER_BYTES);
  mqtt.setKeepAlive(60);
}

void loop() {
  unsigned long now = millis();

  if (!mqtt.connected()) {
    if (now - lastReconnectAt >= RECONNECT_INTERVAL_MS) {
      lastReconnectAt = now;
      connectMqtt();
    }
    return;
  }

  // Services the connection: sends pings, receives messages, fires callbacks.
  // Nothing arrives while this is not being called.
  mqtt.loop();

  if (now - lastReadingAt >= READING_INTERVAL_MS) {
    lastReadingAt = now;

    float temperature = 0.0f;
    float humidity = 0.0f;

    if (readSensor(&temperature, &humidity)) {
      publishReading(temperature, humidity);
    } else {
      Serial.println("Sensor read failed");
    }
  }

  if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = now;
    publishHeartbeat();
  }
}
import "dotenv/config";

/**
 * Fails fast at startup rather than at 3am when a topic silently stops working.
 */
function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill it in.`
    );
  }

  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value;
}

function optionalPort(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port number between 1 and 65535, got "${raw}"`);
  }

  return port;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a whole number above zero, got "${raw}"`);
  }

  return value;
}

function randomSuffix(): string {
  return Math.random().toString(16).slice(2, 8);
}

export const config = {
  mqtt: {
    url: requireEnv("MQTT_URL"),
    username: requireEnv("MQTT_USERNAME"),
    password: requireEnv("MQTT_PASSWORD"),
    clientId: optionalEnv("MQTT_CLIENT_ID", `iot-server-${randomSuffix()}`),
    baseTopic: optionalEnv("MQTT_BASE_TOPIC", "spectral/esp32"),
  },
  llm: {
    // Optional on purpose: the server must still run without an agent.
    configured: (process.env["LLM_API_KEY"] ?? "").trim() !== "",
    apiKey: optionalEnv("LLM_API_KEY", "not-configured"),
    baseUrl: optionalEnv("LLM_BASE_URL", "https://api.groq.com/openai/v1"),
    model: optionalEnv("LLM_MODEL", "llama-3.3-70b-versatile"),
    maxSteps: optionalInt("AGENT_MAX_STEPS", 8),
  },
  http: {
    port: optionalPort("HTTP_PORT", 3000),
    host: optionalEnv("HTTP_HOST", "0.0.0.0"),
    corsOrigin: optionalEnv("CORS_ORIGIN", "http://localhost:3001"),
  },
};
type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, message: string, details?: unknown): void {
  const timestamp = new Date().toISOString();
  const line = `${timestamp} [${level.toUpperCase()}] ${message}`;

  if (details === undefined) {
    console.log(line);
    return;
  }

  console.log(line, details);
}

export const logger = {
  info: (message: string, details?: unknown) => write("info", message, details),
  warn: (message: string, details?: unknown) => write("warn", message, details),
  error: (message: string, details?: unknown) => write("error", message, details),
};

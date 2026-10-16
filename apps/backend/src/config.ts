function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: positiveInteger("PORT", 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  requestTimeoutMs: positiveInteger("REQUEST_TIMEOUT_MS", 10_000),
  maxRequestBytes: positiveInteger("MAX_REQUEST_BYTES", 1_048_576),
  maxResponseBytes: positiveInteger("MAX_RESPONSE_BYTES", 1_048_576),
  logLevel: process.env.LOG_LEVEL ?? "info",
};

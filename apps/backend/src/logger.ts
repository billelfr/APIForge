import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['set-cookie']",
      "req.body.bearerToken",
      "req.body.headers.authorization",
      "req.body.headers.Authorization",
      "authorization",
      "bearerToken",
      "token",
    ],
    censor: "[REDACTED]",
  },
});

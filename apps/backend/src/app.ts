import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { PrismaClient, type Prisma } from "@prisma/client";
import { config } from "./config";
import { logger } from "./logger";
import { OutboundError, sendOutbound } from "./outbound";

const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const durationBounds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const;
const requestCounts = new Map<string, number>();
const errorCounts = new Map<string, number>();
const durationCounts = new Map<string, number>();
const durationSum = new Map<string, number>();
const durationBuckets = new Map<string, number[]>();

function metricMethod(method: string): string {
  return methods.has(method) ? method : "OTHER";
}

function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanSavedHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const sensitiveHeaders = new Set([
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "api-key",
    "x-auth-token",
    "x-access-token",
  ]);
  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(value)) {
    if (typeof header === "string" && !sensitiveHeaders.has(name.toLowerCase())) {
      headers[name] = header;
    }
  }
  return headers;
}

function safeSavedRequest(value: unknown): Prisma.SavedRequestCreateWithoutCollectionInput {
  if (!isRecord(value)) throw new OutboundError("Request data must be a JSON object", 400);
  const { name, method, url, queryParams, headers, body } = value;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof method !== "string" ||
    !methods.has(method) ||
    typeof url !== "string" ||
    (body !== undefined && body !== null && typeof body !== "string")
  ) {
    throw new OutboundError("Request name, method, URL, or body is invalid", 400);
  }
  if (queryParams !== undefined && !isRecord(queryParams)) {
    throw new OutboundError("Query parameters must be a JSON object", 400);
  }
  if (
    queryParams !== undefined &&
    !Object.values(queryParams).every(
      (item) => (typeof item === "string" || typeof item === "number" || typeof item === "boolean") &&
        (typeof item !== "number" || Number.isFinite(item)),
    )
  ) {
    throw new OutboundError("Query parameter values must be strings, numbers, or booleans", 400);
  }
  if (headers !== undefined && !isRecord(headers)) {
    throw new OutboundError("Headers must be a JSON object", 400);
  }
  if (isRecord(headers) && Object.values(headers).some((header) => typeof header !== "string")) {
    throw new OutboundError("Header values must be strings", 400);
  }
  if (body) {
    try {
      JSON.parse(body);
    } catch {
      throw new OutboundError("Request body must contain valid JSON", 400);
    }
  }
  return {
    name: name.trim().slice(0, 120),
    method,
    url,
    queryParams: (queryParams ?? {}) as Prisma.InputJsonObject,
    headers: cleanSavedHeaders(headers) as Prisma.InputJsonObject,
    body: body ?? null,
  };
}

export function createApp(prisma: PrismaClient): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: config.corsOrigin }));
  app.use((req, res, next) => {
    if (req.path === "/metrics") return next();
    const startedAt = performance.now();
    res.on("finish", () => {
      const method = metricMethod(req.method);
      const duration = (performance.now() - startedAt) / 1000;
      const klass = statusClass(res.statusCode);
      const key = `${method}|${klass}`;
      requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
      if (res.statusCode >= 400) errorCounts.set(method, (errorCounts.get(method) ?? 0) + 1);
      durationSum.set(method, (durationSum.get(method) ?? 0) + duration);
      durationCounts.set(method, (durationCounts.get(method) ?? 0) + 1);
      const buckets = durationBuckets.get(method) ?? durationBounds.map(() => 0);
      durationBounds.forEach((bound, index) => {
        if (duration <= bound) buckets[index] += 1;
      });
      durationBuckets.set(method, buckets);
      logger.info({ method, path: req.path, statusCode: res.statusCode, durationMs: Math.round(duration * 1000) }, "http request");
    });
    next();
  });
  app.use(express.json({ limit: config.maxRequestBytes }));

  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ready", database: "connected" });
    } catch {
      res.status(503).json({ status: "not ready", database: "unavailable" });
    }
  });
  app.get("/metrics", (_req, res) => {
    const lines = [
      "# HELP http_requests_total Total HTTP requests.",
      "# TYPE http_requests_total counter",
    ];
    for (const [key, count] of requestCounts) {
      const [method, klass] = key.split("|");
      lines.push(`http_requests_total{method="${method}",status_class="${klass}"} ${count}`);
    }
    lines.push("# HELP http_request_duration_seconds HTTP request duration in seconds.", "# TYPE http_request_duration_seconds histogram");
    const methodsSeen = new Set([...durationCounts.keys()]);
    for (const method of methodsSeen) {
      const count = durationCounts.get(method) ?? 0;
      const sum = durationSum.get(method) ?? 0;
      const buckets = durationBuckets.get(method) ?? [];
      durationBounds.forEach((bound, index) => {
        lines.push(`http_request_duration_seconds_bucket{method="${method}",le="${bound}"} ${buckets[index] ?? 0}`);
      });
      lines.push(`http_request_duration_seconds_bucket{method="${method}",le="+Inf"} ${count}`);
      lines.push(`http_request_duration_seconds_sum{method="${method}"} ${sum}`);
      lines.push(`http_request_duration_seconds_count{method="${method}"} ${count}`);
    }
    lines.push("# HELP http_errors_total Total HTTP responses with error status.", "# TYPE http_errors_total counter");
    for (const [method, count] of errorCounts) lines.push(`http_errors_total{method="${method}"} ${count}`);
    res.type("text/plain; version=0.0.4; charset=utf-8").send(`${lines.join("\n")}\n`);
  });

  app.post("/api/execute", async (req, res, next) => {
    try {
      res.json(await sendOutbound(req.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/collections", async (_req, res, next) => {
    try {
      res.json(await prisma.collection.findMany({ include: { requests: true }, orderBy: { createdAt: "asc" } }));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/collections", async (req, res, next) => {
    try {
      if (!isRecord(req.body) || typeof req.body.name !== "string" || !req.body.name.trim()) {
        throw new OutboundError("A collection name is required", 400);
      }
      res.status(201).json(await prisma.collection.create({ data: { name: req.body.name.trim().slice(0, 120) } }));
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/collections/:collectionId", async (req, res, next) => {
    try {
      if (!isRecord(req.body) || typeof req.body.name !== "string" || !req.body.name.trim()) {
        throw new OutboundError("A collection name is required", 400);
      }
      res.json(await prisma.collection.update({
        where: { id: req.params.collectionId },
        data: { name: req.body.name.trim().slice(0, 120) },
      }));
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/collections/:collectionId", async (req, res, next) => {
    try {
      await prisma.collection.delete({ where: { id: req.params.collectionId } });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/collections/:collectionId/requests", async (req, res, next) => {
    try {
      res.json(await prisma.savedRequest.findMany({
        where: { collectionId: req.params.collectionId },
        orderBy: { createdAt: "asc" },
      }));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/collections/:collectionId/requests", async (req, res, next) => {
    try {
      res.status(201).json(await prisma.savedRequest.create({
        data: { ...safeSavedRequest(req.body), collectionId: req.params.collectionId },
      }));
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/requests/:requestId", async (req, res, next) => {
    try {
      res.json(await prisma.savedRequest.update({
        where: { id: req.params.requestId },
        data: safeSavedRequest(req.body),
      }));
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/requests/:requestId", async (req, res, next) => {
    try {
      await prisma.savedRequest.delete({ where: { id: req.params.requestId } });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof OutboundError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    const prismaCode =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (prismaCode === "P2025") return res.status(404).json({ error: "Record not found" });
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error.status === 400 || error.status === 413)
    ) {
      return res.status(error.status).json({
        error: error.status === 413 ? "Request body exceeds the configured size limit" : "Invalid JSON request",
      });
    }
    logger.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "request failed");
    return res.status(500).json({ error: "Internal server error" });
  });
  return app;
}

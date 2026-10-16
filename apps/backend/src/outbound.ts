import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import ipaddr from "ipaddr.js";
import { config } from "./config";

export class OutboundError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "OutboundError";
  }
}

function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

function parseTarget(value: string): URL {
  if (value.length > 2048) throw new OutboundError("URL is too long", 400);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundError("A valid absolute URL is required", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OutboundError("Only HTTP and HTTPS URLs are allowed", 400);
  }
  if (url.username || url.password) {
    throw new OutboundError("Credentials in URLs are not allowed", 400);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new OutboundError("Requests to local hostnames are not allowed", 400);
  }
  url.hash = "";
  return url;
}

async function resolvePublicTarget(hostname: string, timeoutMs: number): Promise<LookupAddress[]> {
  if (ipaddr.isValid(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new OutboundError("Requests to private or reserved addresses are not allowed", 400);
    }
    const parsed = ipaddr.parse(hostname);
    return [{ address: hostname, family: parsed.kind() === "ipv4" ? 4 : 6 }];
  }

  let addresses: LookupAddress[];
  let lookupTimer: NodeJS.Timeout | undefined;
  try {
    addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        lookupTimer = setTimeout(
          () => reject(new OutboundError("Destination hostname lookup timed out", 504)),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof OutboundError) throw error;
    throw new OutboundError("The destination hostname could not be resolved", 400);
  } finally {
    if (lookupTimer) clearTimeout(lookupTimer);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new OutboundError("The destination resolves to a private or reserved address", 400);
  }
  return addresses;
}

function requestHeaders(input: unknown, bearerToken: unknown, host: string): Record<string, string> {
  const headers: Record<string, string> = { host };
  const blocked = new Set([
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    "proxy-authorization",
    "proxy-connection",
    "upgrade",
    "expect",
  ]);
  if (input !== undefined && (typeof input !== "object" || input === null || Array.isArray(input))) {
    throw new OutboundError("Headers must be a JSON object", 400);
  }
  for (const [name, value] of Object.entries((input ?? {}) as Record<string, unknown>)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== "string") {
      throw new OutboundError("Each header must have a valid name and string value", 400);
    }
    if (value.length > 8192 || /[\r\n]/.test(value)) {
      throw new OutboundError("Header values must be at most 8192 characters and contain no line breaks", 400);
    }
    if (!blocked.has(name.toLowerCase())) headers[name] = value;
  }
  if (bearerToken !== undefined && bearerToken !== null && bearerToken !== "") {
    if (typeof bearerToken !== "string" || bearerToken.length > 8192) {
      throw new OutboundError("Bearer token must be a string of at most 8192 characters", 400);
    }
    headers.authorization = `Bearer ${bearerToken}`;
  }
  return headers;
}

export interface OutboundInput {
  method: string;
  url: string;
  queryParams?: unknown;
  headers?: unknown;
  bearerToken?: unknown;
  body?: unknown;
}

export interface OutboundResult {
  status: number;
  durationMs: number;
  headers: Record<string, string | string[]>;
  body: string;
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export async function sendOutbound(input: OutboundInput): Promise<OutboundResult> {
  const startedAt = performance.now();
  if (!METHODS.has(input.method)) throw new OutboundError("Unsupported HTTP method", 400);
  if (typeof input.url !== "string") throw new OutboundError("A URL is required", 400);
  if (input.body !== undefined && typeof input.body !== "string") {
    throw new OutboundError("Request body must be a string", 400);
  }
  const body = input.body as string | undefined;
  if (body && Buffer.byteLength(body, "utf8") > config.maxRequestBytes) {
    throw new OutboundError("Request body exceeds the configured size limit", 413);
  }
  if (body) {
    try {
      JSON.parse(body);
    } catch {
      throw new OutboundError("Request body must contain valid JSON", 400);
    }
  }

  const url = parseTarget(input.url);
  if (input.queryParams !== undefined) {
    if (
      typeof input.queryParams !== "object" ||
      input.queryParams === null ||
      Array.isArray(input.queryParams)
    ) {
      throw new OutboundError("Query parameters must be a JSON object", 400);
    }
    for (const [key, value] of Object.entries(input.queryParams as Record<string, unknown>)) {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new OutboundError("Query parameter values must be strings, numbers, or booleans", 400);
      }
      url.searchParams.set(key, String(value));
    }
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const remainingTimeout = Math.max(1, config.requestTimeoutMs - (performance.now() - startedAt));
  const addresses = await resolvePublicTarget(hostname, remainingTimeout);
  const selected = addresses[0];
  const headers = requestHeaders(input.headers, input.bearerToken, url.host);
  if (body !== undefined && !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
    headers["content-type"] = "application/json";
  }

  const requestOptions = {
    protocol: url.protocol,
    hostname: selected.address,
    family: selected.family,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    method: input.method,
    path: `${url.pathname}${url.search}`,
    headers,
  };
  return new Promise((resolve, reject) => {
    let outboundRequest: ReturnType<typeof httpRequest>;
    const onResponse = (response: IncomingMessage): void => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > config.maxResponseBytes) {
          outboundRequest.destroy(new OutboundError("Response exceeds the configured size limit", 502));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        const responseHeaders: Record<string, string | string[]> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) responseHeaders[name] = value;
        }
        resolve({
          status: response.statusCode ?? 502,
          durationMs: Math.round(performance.now() - startedAt),
          headers: responseHeaders,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      response.on("error", reject);
    };
    outboundRequest = url.protocol === "https:"
      ? httpsRequest(
          {
            ...requestOptions,
            ...(!ipaddr.isValid(hostname) ? { servername: hostname } : {}),
          },
          onResponse,
        )
      : httpRequest(requestOptions, onResponse);
    const requestTimeout = Math.max(1, config.requestTimeoutMs - (performance.now() - startedAt));
    const timeout = setTimeout(() => {
      outboundRequest.destroy(new OutboundError("Outbound request timed out", 504));
    }, requestTimeout);
    outboundRequest.on("close", () => clearTimeout(timeout));
    outboundRequest.on("error", reject);
    if (body !== undefined) outboundRequest.write(body);
    outboundRequest.end();
  });
}

export const outboundSafety = { isPublicAddress, parseTarget, resolvePublicTarget };

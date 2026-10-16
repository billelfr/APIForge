import { describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app";

describe("GET /health/live", () => {
  it("confirms the process is running", async () => {
    const app = createApp(new PrismaClient());
    const response = await request(app).get("/health/live");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});

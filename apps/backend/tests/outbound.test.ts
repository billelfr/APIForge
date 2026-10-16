import { describe, expect, it } from "vitest";
import { outboundSafety, sendOutbound } from "../src/outbound";

describe("outbound URL safety", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1", "::ffff:127.0.0.1"])(
    "rejects non-public address %s",
    (address) => {
      expect(outboundSafety.isPublicAddress(address)).toBe(false);
    },
  );

  it.each(["file:///etc/passwd", "ftp://example.com", "http://localhost", "http://127.0.0.1"])(
    "rejects unsafe URL %s",
    async (url) => {
      await expect(sendOutbound({ method: "GET", url })).rejects.toThrow();
    },
  );

  it("rejects unsupported methods", async () => {
    await expect(sendOutbound({ method: "OPTIONS", url: "https://example.com" })).rejects.toThrow(
      "Unsupported HTTP method",
    );
  });
});

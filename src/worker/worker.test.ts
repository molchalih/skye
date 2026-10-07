import { describe, expect, it } from "vitest";

describe("the worker module outside a worker", () => {
  it("imports on a server without throwing or serving", async () => {
    expect(typeof self).toBe("undefined");
    await expect(import("./worker.ts")).resolves.toBeDefined();
  });
});

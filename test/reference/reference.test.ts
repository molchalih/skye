import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const V6_SHA256 = "c25415fd8157158a66d37acc94bfec70a792b84febe917232be789f4f0703d0b";

describe("v6 reference", () => {
  it("is the vendored file, byte for byte", () => {
    const bytes = readFileSync(new URL("./weather-sky-v6.js", import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(V6_SHA256);
  });
});

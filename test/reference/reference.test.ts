import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// References that never change: v6 as vendored, and the look frozen on 2026-10-10. A new baseline is a new file, added
// by the owner's decision (CONTRIBUTING.md, Look preservation); this one stays as long as the gate reads it.
const FROZEN: Record<string, string> = {
  "weather-sky-v6.js": "c25415fd8157158a66d37acc94bfec70a792b84febe917232be789f4f0703d0b",
  "skye-baseline-2026-10.js": "f5373006da0e4ff4218916131ba01f22832625490d4dfa66c851ea4dfecde564",
  "skye-baseline-2026-10.d.ts": "d6d18f7917a2e0cbbdc853879946de79a1d66c706cb1ca5cf753ed92360189f6",
};

describe("frozen references", () => {
  it.each(Object.entries(FROZEN))("%s is the committed file, byte for byte", (file, sha256) => {
    const bytes = readFileSync(new URL(`./${file}`, import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  });
});

import { describe, expect, it } from "vitest";
import { QualityController } from "./quality.ts";

function run(q: QualityController, frames: number, dt: number, cap: number, gpu: number): void {
  for (let i = 0; i < frames; i++) q.observe(dt, cap, gpu);
}

describe("QualityController", () => {
  it("starts at balanced", () => {
    expect(new QualityController().tier).toBe(1);
  });

  it("steps down on a slow GPU only after the 60-frame warmup", () => {
    const q = new QualityController();
    run(q, 60, 16, 60, 12);
    expect(q.tier).toBe(1);
    const r = q.observe(16, 60, 12);
    expect(q.tier).toBe(0);
    expect(r).toEqual({ tier: 0, changed: true, resetGpu: true });
  });

  it("does not step down at or under budget, and budget is 20 ms at a 30 fps cap", () => {
    const a = new QualityController();
    run(a, 200, 16, 60, 9.5);
    expect(a.tier).toBe(1);
    const b = new QualityController();
    run(b, 200, 33, 30, 15);
    expect(b.tier).toBe(1);
    run(b, 200, 33, 30, 21);
    expect(b.tier).toBe(0);
  });

  it("steps up after 300 frames well under budget, then waits again", () => {
    const q = new QualityController();
    run(q, 300, 16, 60, 2);
    expect(q.tier).toBe(1);
    const r = q.observe(16, 60, 2);
    expect(q.tier).toBe(2);
    expect(r.resetGpu).toBe(true);
    run(q, 400, 16, 60, 0.5);
    expect(q.tier).toBe(2);
  });

  it("does not step up when GPU time is only moderately low", () => {
    const q = new QualityController();
    run(q, 1000, 16, 60, 9.5 * 0.35 + 0.1);
    expect(q.tier).toBe(1);
  });

  it("falls back to the frame interval without a GPU timer, never stepping up or resetting the GPU average", () => {
    const q = new QualityController();
    run(q, 90, 40, 60, -1);
    expect(q.tier).toBe(1);
    const r = q.observe(40, 60, -1);
    expect(q.tier).toBe(0);
    expect(r).toEqual({ tier: 0, changed: true, resetGpu: false });
    run(q, 2000, 1, 60, -1);
    expect(q.tier).toBe(0);
  });

  it("stays within the tier bounds", () => {
    const q = new QualityController();
    run(q, 5000, 16, 60, 50);
    expect(q.tier).toBe(0);
    run(q, 5000, 16, 60, 0.1);
    expect(q.tier).toBe(2);
  });
});

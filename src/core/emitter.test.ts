import { afterEach, describe, expect, it, vi } from "vitest";
import { Emitter } from "./emitter.ts";

interface Events {
  ready: undefined;
  count: number;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Emitter", () => {
  it("calls listeners of the emitted event in subscription order", () => {
    const e = new Emitter<Events>();
    const seen: string[] = [];
    e.on("count", (n) => seen.push(`a${n}`));
    e.on("count", (n) => seen.push(`b${n}`));
    e.on("ready", () => seen.push("ready"));
    expect(e.emit("count", 2)).toBe(true);
    expect(seen).toEqual(["a2", "b2"]);
  });

  it("reports whether anyone listened", () => {
    const e = new Emitter<Events>();
    expect(e.emit("ready", undefined)).toBe(false);
    const off = e.on("ready", () => undefined);
    expect(e.emit("ready", undefined)).toBe(true);
    off();
    expect(e.emit("ready", undefined)).toBe(false);
  });

  it("unsubscribes only the listener it was returned for", () => {
    const e = new Emitter<Events>();
    const seen: number[] = [];
    const off = e.on("count", (n) => seen.push(n));
    e.on("count", (n) => seen.push(n * 10));
    off();
    off();
    e.emit("count", 1);
    expect(seen).toEqual([10]);
  });

  it("drops every listener on clear", () => {
    const e = new Emitter<Events>();
    const seen: number[] = [];
    e.on("count", (n) => seen.push(n));
    e.clear();
    expect(e.emit("count", 1)).toBe(false);
    expect(seen).toEqual([]);
  });

  it("replays a latched payload to later listeners on a microtask", async () => {
    const e = new Emitter<Events>();
    const early: number[] = [];
    e.on("count", (n) => early.push(n));
    e.latch("count", 7);
    expect(e.heard("count")).toBe(true);
    const late: number[] = [];
    e.on("count", (n) => late.push(n));
    expect(late).toEqual([]);
    await Promise.resolve();
    expect(late).toEqual([7]);
    expect(early).toEqual([7]);
  });

  it("latches even when nobody listens, and skips a listener removed before the replay", async () => {
    const e = new Emitter<Events>();
    e.latch("count", 3);
    expect(e.heard("count")).toBe(false);
    const seen: number[] = [];
    const off = e.on("count", (n) => seen.push(n));
    expect(e.listening("count")).toBe(true);
    off();
    expect(e.listening("count")).toBe(false);
    e.on("ready", () => seen.push(-1));
    await Promise.resolve();
    expect(seen).toEqual([]);
    // Only a delivered replay counts as heard.
    expect(e.heard("count")).toBe(false);
    e.on("count", (n) => seen.push(n));
    await Promise.resolve();
    expect(seen).toEqual([3]);
    expect(e.heard("count")).toBe(true);
  });

  it("cancels pending replays and forgets latched payloads on clear", async () => {
    const e = new Emitter<Events>();
    e.latch("count", 1);
    const seen: number[] = [];
    e.on("count", (n) => seen.push(n));
    e.clear();
    e.on("count", (n) => seen.push(n * 10));
    await Promise.resolve();
    expect(seen).toEqual([]);
  });

  it("reports a throwing listener and still calls the rest", async () => {
    const reported: unknown[] = [];
    vi.stubGlobal("reportError", (error: unknown) => reported.push(error));
    const e = new Emitter<Events>();
    const seen: number[] = [];
    const boom = new Error("boom");
    e.on("count", () => {
      throw boom;
    });
    e.on("count", (n) => seen.push(n));
    expect(() => e.emit("count", 1)).not.toThrow();
    expect(seen).toEqual([1]);
    e.latch("count", 2);
    e.on("count", () => {
      throw boom;
    });
    await Promise.resolve();
    expect(reported).toEqual([boom, boom, boom]);
  });

  it("rethrows from a microtask where the scope has no reportError", () => {
    vi.stubGlobal("reportError", undefined);
    const tasks: (() => void)[] = [];
    vi.stubGlobal("queueMicrotask", (task: () => void) => tasks.push(task));
    const e = new Emitter<Events>();
    const boom = new Error("boom");
    e.on("ready", () => {
      throw boom;
    });
    expect(() => e.emit("ready", undefined)).not.toThrow();
    expect(tasks).toHaveLength(1);
    expect(() => tasks[0]?.()).toThrow(boom);
  });
});

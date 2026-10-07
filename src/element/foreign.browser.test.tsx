import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Skye } from "../react/index.tsx";
import { defineSkye, defineSkyeQuietly } from "./define.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

class Foreign extends HTMLElement {}
customElements.define("skye-view", Foreign);

// A skye whose element contract differs from this copy's.
class FutureSkye extends HTMLElement {}
Object.defineProperty(FutureSkye, Symbol.for("skye.element"), { value: 2 });
customElements.define("future-sky", FutureSkye);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a tag held by an element that is not skye's", () => {
  it("makes an explicit defineSkye throw", () => {
    expect(() => defineSkye()).toThrow(/<skye-view> is already defined by another element/);
    expect(customElements.get("skye-view")).toBe(Foreign);
  });

  it("treats a skye of another brand version as foreign, naming its version", () => {
    expect(() => defineSkye("future-sky")).toThrow(/held by skye v2/);
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    expect(() => defineSkyeQuietly("future-sky")).not.toThrow();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("does not throw on the implicit path when reportError is missing", () => {
    vi.stubGlobal("reportError", undefined);
    const deferred: (() => void)[] = [];
    vi.stubGlobal("queueMicrotask", (fn: () => void) => deferred.push(fn));
    expect(() => defineSkyeQuietly()).not.toThrow();
    expect(deferred).toHaveLength(1);
  });

  it("reports it, without throwing, when @a240/skye/define is evaluated", async () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    await expect(import("../define.ts")).resolves.toBeDefined();
    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0]?.[0])).toMatch(/already defined by another element/);
  });

  it("reports it, without throwing, when <Skye> mounts", async () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    const box = document.createElement("div");
    document.body.append(box);
    const root = createRoot(box);
    try {
      await act(async () => {
        root.render(<Skye scene="clear" />);
      });
      expect(box.querySelector("skye-view")).toBeInstanceOf(Foreign);
      expect(report).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        root.unmount();
      });
      box.remove();
    }
  });
});

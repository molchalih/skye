import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextEvent, unmountAll } from "../../test/support/element.ts";
import { Skye } from "../react/index.tsx";
import { defineSkye } from "./define.ts";
import { SKYE_READY, SkyeElement as FirstCopy } from "./element.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

// A second copy of skye: the same source evaluated again, so its element class is a different constructor.
const secondUrl = "./element.ts?second-copy";
const second: { SkyeElement: typeof FirstCopy } = await import(/* @vite-ignore */ secondUrl);
customElements.define("skye-view", second.SkyeElement);

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
});

describe("a page that loads skye twice", () => {
  it("is a different class that carries the same brand", () => {
    expect(customElements.get("skye-view")).toBe(second.SkyeElement);
    expect(Reflect.get(second.SkyeElement, Symbol.for("skye.element"))).toBe(1);
    const brand = Object.getOwnPropertyDescriptor(second.SkyeElement, Symbol.for("skye.element"));
    expect(brand).toMatchObject({ writable: false, enumerable: false, configurable: false });
    expect(document.createElement("skye-view")).not.toBeInstanceOf(FirstCopy);
  });

  it("returns the other copy's registration from defineSkye", () => {
    expect(defineSkye()).toBe(second.SkyeElement);
  });

  it("does not throw or report anything when @a240/skye/define is evaluated", async () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    await expect(import("../define.ts")).resolves.toBeDefined();
    expect(report).not.toHaveBeenCalled();
  });

  it("lets <Skye> mount on the other copy's element, and the sky draws", async () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    const box = document.createElement("div");
    box.style.cssText = "position:relative;width:160px;height:100px";
    document.body.append(box);
    const root = createRoot(box);
    try {
      await act(async () => {
        root.render(<Skye scene="clear" motion="static" quality="balanced" />);
      });
      const el = box.querySelector("skye-view");
      if (el === null) throw new Error("no skye-view");
      expect(el).toBeInstanceOf(second.SkyeElement);
      await nextEvent(el, SKYE_READY);
      expect(report).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
      });
      box.remove();
    }
  });
});

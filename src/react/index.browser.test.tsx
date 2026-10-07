import { StrictMode, createRef, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { until } from "../../test/support/element.ts";
import type { TierChange } from "../index.ts";
import { SkyeElement } from "../element/index.ts";
import { Skye, useSkyeStats, type SkyeProps } from "./index.tsx";

// `act` environment flag so React flushes effects synchronously inside act().
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const roots: { root: Root; box: HTMLElement }[] = [];

async function render(ui: React.ReactNode): Promise<HTMLElement> {
  const box = document.createElement("div");
  box.style.cssText = "position:relative;width:160px;height:100px";
  document.body.append(box);
  const root = createRoot(box);
  roots.push({ root, box });
  await act(async () => {
    root.render(ui);
  });
  return box;
}

function viewIn(box: HTMLElement): SkyeElement {
  const el = box.querySelector("skye-view");
  if (el === null) throw new Error("no skye-view");
  return el;
}

afterEach(async () => {
  const mounted = roots.splice(0);
  await act(async () => {
    for (const { root } of mounted) root.unmount();
  });
  for (const { box } of mounted) box.remove();
});

describe("props to attributes", () => {
  it("writes camelCase params as kebab attributes and booleans as 1/0", async () => {
    const box = await render(
      <Skye
        scene="rainy"
        cover={0.4}
        dayOfYear={120}
        solarNoon={12.5}
        moonPhase={0.5}
        focus={0.3}
        blur={8}
        glass
      />,
    );
    const el = viewIn(box);
    expect(el.getAttribute("scene")).toBe("rainy");
    expect(el.getAttribute("cover")).toBe("0.4");
    expect(el.getAttribute("day-of-year")).toBe("120");
    expect(el.getAttribute("solar-noon")).toBe("12.5");
    expect(el.getAttribute("moon-phase")).toBe("0.5");
    expect(el.getAttribute("focus-depth")).toBe("0.3");
    expect(el.getAttribute("blur-radius")).toBe("8");
    expect(el.getAttribute("glass")).toBe("1");
  });

  it("writes glass={false} as 0 and omits undefined props", async () => {
    const box = await render(<Skye glass={false} hour={undefined} />);
    const el = viewIn(box);
    expect(el.getAttribute("glass")).toBe("0");
    expect(el.hasAttribute("hour")).toBe(false);
    expect(el.hasAttribute("scene")).toBe(false);
    expect(el.hasAttribute("worker")).toBe(false);
  });

  it("passes standard HTML attributes through to the element", async () => {
    const box = await render(
      <Skye
        id="backdrop"
        title="The sky"
        role="img"
        tabIndex={-1}
        aria-hidden
        aria-label="Weather"
        data-testid="sky"
        data-scene-source="forecast"
        className="sky"
        style={{ opacity: 0.5 }}
        scene="fog"
        dayOfYear={100}
      />,
    );
    const el = viewIn(box);
    expect(el.id).toBe("backdrop");
    expect(el.getAttribute("title")).toBe("The sky");
    expect(el.getAttribute("role")).toBe("img");
    expect(el.getAttribute("tabindex")).toBe("-1");
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.getAttribute("aria-label")).toBe("Weather");
    expect(el.getAttribute("data-testid")).toBe("sky");
    expect(el.dataset["sceneSource"]).toBe("forecast");
    expect(el.getAttribute("class")).toBe("sky");
    expect(el.style.opacity).toBe("0.5");
    expect(el.getAttribute("scene")).toBe("fog");
    // Params go only under their attribute names.
    expect(el.getAttribute("day-of-year")).toBe("100");
    expect(el.hasAttribute("dayofyear")).toBe(false);
  });

  it("passes hidden through as the boolean attribute", async () => {
    const box = await render(<Skye hidden />);
    expect(viewIn(box).hasAttribute("hidden")).toBe(true);
  });

  it("removes an attribute when its prop becomes undefined", async () => {
    const box = await render(<Skye hour={6} />);
    expect(viewIn(box).getAttribute("hour")).toBe("6");
    await act(async () => roots[0]?.root.render(<Skye />));
    expect(viewIn(box).hasAttribute("hour")).toBe(false);
  });

  it("maps worker true to an empty attribute and a string to the URL", async () => {
    const on = viewIn(await render(<Skye worker />));
    expect(on.getAttribute("worker")).toBe("");
    const url = viewIn(await render(<Skye worker="/w.js" />));
    expect(url.getAttribute("worker")).toBe("/w.js");
    const off = viewIn(await render(<Skye worker={false} />));
    expect(off.hasAttribute("worker")).toBe(false);
  });

  it("applies className and style", async () => {
    const el = viewIn(await render(<Skye className="sky" style={{ opacity: 0.5 }} />));
    expect(el.classList.contains("sky")).toBe(true);
    expect(el.style.opacity).toBe("0.5");
  });
});

describe("ref and events", () => {
  it("gives the ref the upgraded element, as object and as callback ref", async () => {
    const ref = createRef<SkyeElement>();
    await render(<Skye ref={ref} />);
    expect(ref.current).toBeInstanceOf(SkyeElement);
    expect(typeof ref.current?.stats).toBe("function");

    let received: SkyeElement | null = null;
    await render(<Skye ref={(el) => void (received = el)} />);
    expect(received).toBeInstanceOf(SkyeElement);
  });

  it("calls onReady and keeps the latest callback across re-renders", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const box = await render(<Skye scene="clear" onReady={first} />);
    await act(async () => roots[0]?.root.render(<Skye scene="clear" onReady={second} />));
    await until(() => first.mock.calls.length + second.mock.calls.length > 0, "skye-ready");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(viewIn(box)).toBeInstanceOf(SkyeElement);
  });

  it("passes the typed detail of error and tier change events", async () => {
    const onError = vi.fn<NonNullable<SkyeProps["onError"]>>();
    const onTierChange = vi.fn<NonNullable<SkyeProps["onTierChange"]>>();
    const onFallback = vi.fn();
    const box = await render(
      <Skye onError={onError} onTierChange={onTierChange} onFallback={onFallback} />,
    );
    const el = viewIn(box);
    const failure = new Error("boom");
    const change: TierChange = { quality: "balanced", tier: 1 };
    el.dispatchEvent(new CustomEvent("skye-error", { detail: failure }));
    el.dispatchEvent(new CustomEvent("skye-tierchange", { detail: change }));
    el.dispatchEvent(new CustomEvent("skye-fallback", { detail: null }));
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onTierChange).toHaveBeenCalledWith(change);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("removes its listeners on unmount", async () => {
    const onReady = vi.fn();
    const box = await render(<Skye onReady={onReady} />);
    const el = viewIn(box);
    await act(async () => roots[0]?.root.render(null));
    el.dispatchEvent(new CustomEvent("skye-ready", { detail: null }));
    expect(onReady).not.toHaveBeenCalled();
  });
});

function Stats({ onStats }: { onStats: (s: unknown) => void }) {
  const ref = useRef<SkyeElement | null>(null);
  const stats = useSkyeStats(ref, 20);
  onStats(stats);
  return <Skye ref={ref} scene="clear" />;
}

describe("useSkyeStats", () => {
  it("is null before the renderer exists and reports stats once it draws", async () => {
    const seen: unknown[] = [];
    await render(<Stats onStats={(s) => seen.push(s)} />);
    expect(seen[0]).toBeNull();
    await until(() => seen.some((s) => s !== null), "stats");
    expect(seen.at(-1)).toMatchObject({ quality: expect.any(String) });
  });
});

describe("useSkyeStats interval", () => {
  it("clamps a zero, negative or NaN interval instead of spinning", async () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    try {
      for (const interval of [0, -5, Number.NaN]) {
        function Probe() {
          const ref = useRef<SkyeElement | null>(null);
          useSkyeStats(ref, interval);
          return null;
        }
        await render(<Probe />);
      }
      const delays = spy.mock.calls.map(([, delay]) => delay);
      expect(delays.length).toBeGreaterThanOrEqual(3);
      for (const delay of delays) expect(delay).toBeGreaterThanOrEqual(16);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("StrictMode", () => {
  it("leaves exactly one live renderer", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    try {
      const onReady = vi.fn();
      const box = await render(
        <StrictMode>
          <Skye scene="clear" onReady={onReady} />
        </StrictMode>,
      );
      const el = viewIn(box);
      await until(() => (el.stats()?.passes ?? 0) > 0, "a frame");
      // Teardown is deferred to a later task; wait it out.
      await new Promise((r) => setTimeout(r, 100));
      expect(box.querySelectorAll("skye-view")).toHaveLength(1);
      const canvases = new Set(
        getContext.mock.calls.flatMap(([kind], i) =>
          kind === "webgl2" ? [getContext.mock.contexts[i]] : [],
        ),
      );
      expect(canvases.size).toBe(1);
      expect(el.stats()).not.toBeNull();
      expect(onReady).toHaveBeenCalledTimes(1);
    } finally {
      getContext.mockRestore();
    }
  });
});

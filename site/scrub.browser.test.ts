import { afterEach, describe, expect, it } from "vitest";
import { scrubbable } from "./scrub.ts";

const frame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));

/** A value on the page from 0 to 10, a click a notch of 1, a pixel of drag 0.1. */
function setup(): { el: HTMLElement; value: () => number; actives: boolean[] } {
  const el = document.createElement("span");
  el.textContent = "five";
  el.tabIndex = 0;
  document.body.append(el);
  // Synthetic presses have no live pointer to capture.
  el.setPointerCapture = () => {};
  let value = 5;
  const actives: boolean[] = [];
  scrubbable(el, {
    get: () => value,
    set: (v) => (value = v),
    steps: () => ({ range: [0, 10], step: 1 }),
    perPixel: 0.1,
    fine: 0.1,
    onActive: (active) => actives.push(active),
  });
  return { el, value: () => value, actives };
}

function pointer(el: HTMLElement, type: string, clientX: number): void {
  const box = el.getBoundingClientRect();
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: box.left + clientX,
      clientY: box.top + box.height / 2,
    }),
  );
}

afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset.scrubbing;
});

describe("scrubbing a value", () => {
  it("ends the drag when the capture is lost, and later moves leave the value alone", async () => {
    const { el, value, actives } = setup();
    pointer(el, "pointerdown", 4);
    // The drag takes hold on the first move past the slop, and measures from there.
    pointer(el, "pointermove", 24);
    pointer(el, "pointermove", 44);
    await frame();
    expect(value()).toBeCloseTo(7);
    expect(document.documentElement.dataset.scrubbing).toBe("");

    el.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1 }));
    expect(document.documentElement.dataset.scrubbing).toBeUndefined();
    expect(el.dataset.active).toBeUndefined();
    expect(actives).toEqual([true, false]);

    const held = value();
    pointer(el, "pointermove", 120);
    await frame();
    expect(value()).toBe(held);
  });

  it("ends a press that never ended before the next one begins", async () => {
    const { el, value, actives } = setup();
    pointer(el, "pointerdown", 4);
    pointer(el, "pointermove", 24);
    await frame();
    // No pointerup, no lost capture: the next press starts over from where the value stands.
    pointer(el, "pointerdown", 4);
    expect(actives).toEqual([true, false]);
    const held = value();
    pointer(el, "pointermove", 6);
    await frame();
    expect(value()).toBe(held);
  });

  it("steps a notch on a click, and not after a drag", async () => {
    const { el, value } = setup();
    pointer(el, "pointerdown", 4);
    pointer(el, "pointerup", 4);
    el.click();
    expect(value()).toBe(6);

    pointer(el, "pointerdown", 4);
    pointer(el, "pointermove", 34);
    await frame();
    pointer(el, "pointerup", 34);
    const dragged = value();
    el.click();
    expect(value()).toBe(dragged);
  });
});

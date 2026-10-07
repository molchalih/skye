import { describe, expect, expectTypeOf, it } from "vitest";
import type { TierChange } from "../core/api.ts";
import type { SkyeElement, SkyeElementEventMap } from "./index.ts";

describe("without a DOM", () => {
  it("imports the element entry and the define entry without throwing", async () => {
    expect(typeof HTMLElement).toBe("undefined");
    const element = await import("./index.ts");
    expect(element.SKYE_ATTRIBUTES).toContain("scene");
    expect(typeof element.SkyeElement).toBe("function");
    await expect(import("../define.ts")).resolves.toBeDefined();
  });
});

describe("types", () => {
  it("maps the tag and types the element's events", () => {
    expectTypeOf<HTMLElementTagNameMap["skye-view"]>().toEqualTypeOf<SkyeElement>();
    expectTypeOf<SkyeElementEventMap["skye-tierchange"]>().toEqualTypeOf<CustomEvent<TierChange>>();
    expectTypeOf<SkyeElementEventMap["skye-error"]>().toEqualTypeOf<CustomEvent<Error>>();
    expectTypeOf<SkyeElementEventMap["skye-ready"]>().toEqualTypeOf<CustomEvent<null>>();
    // Listener parameters are inferred from the event name; checked by the compiler, never run.
    const listen = (el: SkyeElement): void => {
      el.addEventListener("skye-tierchange", (e) => {
        expectTypeOf(e.detail).toEqualTypeOf<TierChange>();
      });
      el.addEventListener("click", (e) => {
        expectTypeOf(e).toEqualTypeOf<HTMLElementEventMap["click"]>();
      });
    };
    expectTypeOf(listen).toBeFunction();
  });
});

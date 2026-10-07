import { afterEach, describe, expect, it, vi } from "vitest";
import { wait } from "../../test/support/sky.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the worker module in a page", () => {
  it("imports without serving: no probe is posted and no listener is added", async () => {
    const posted = vi.spyOn(window, "postMessage");
    const listened = vi.spyOn(window, "addEventListener");
    const messages: unknown[] = [];
    // Only the protocol's probe answers: the test runner may use the page's messages for itself.
    const onMessage = (event: MessageEvent<unknown>): void => {
      const type: unknown =
        typeof event.data === "object" && event.data !== null
          ? Reflect.get(event.data, "type")
          : undefined;
      if (type === "supported" || type === "unsupported") messages.push(event.data);
    };
    window.addEventListener("message", onMessage);
    listened.mockClear();
    await import("./worker.ts");
    await wait(50);
    window.removeEventListener("message", onMessage);
    expect(posted).not.toHaveBeenCalled();
    expect(listened.mock.calls.filter(([type]) => type === "message")).toEqual([]);
    expect(messages).toEqual([]);
  });
});

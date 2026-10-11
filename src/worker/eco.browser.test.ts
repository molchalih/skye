import { afterEach, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { mount, nextEvent, unmountAll, until } from "../../test/support/element.ts";
import { rendersInWorkers, workerWebGL2 } from "../../test/support/worker-webgl2.ts";
import { SKYE_READY, SKYE_TIERCHANGE, defineSkye } from "../element/index.ts";

defineSkye();

// Without WebGL2 in workers the sky falls back to the main thread, which must draw eco the same way.
const WORKER_WEBGL2 = rendersInWorkers(server.browser, await workerWebGL2());

afterEach(() => {
  unmountAll();
});

describe("the eco tier in a worker", () => {
  it("draws eco in the worker, switches to and from it, and never reports a tier change", async () => {
    // 160×80 CSS px at ratio 1: eco's 0.75 cap draws 120×60, its sky at 0.3 of that.
    const eco = { out: [120, 60], sky: [36, 18], scene: [60, 30] };
    const { el } = mount({ worker: "", quality: "eco", motion: "static" }, 160, 80);
    const changes: Event[] = [];
    el.addEventListener(SKYE_TIERCHANGE, (e) => changes.push(e));
    await nextEvent(el, SKYE_READY);
    await until(() => (el.stats()?.passes ?? 0) > 0, "a drawn eco frame");
    expect(el.stats()).toMatchObject({
      worker: WORKER_WEBGL2,
      quality: "eco",
      auto: false,
      tier: 1,
      fpsCap: 20,
      ...eco,
    });

    el.setAttribute("quality", "low");
    // Worker stats are a snapshot, so wait for one taken after the new tier's frame.
    await until(() => el.stats()?.out[0] === 160, "a drawn low frame");
    expect(el.stats()).toMatchObject({ quality: "low", out: [160, 80], sky: [48, 24], fpsCap: 30 });
    el.setAttribute("quality", "eco");
    await until(() => el.stats()?.out[0] === 120, "a drawn eco frame again");
    expect(el.stats()).toMatchObject({ quality: "eco", ...eco });
    el.setAttribute("quality", "auto");
    await until(() => el.stats()?.auto === true, "the auto tier");
    expect(el.stats()?.quality).toBe("balanced");
    expect(changes).toEqual([]);
  });
});

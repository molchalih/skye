import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { BASE, CASES, SIZES } from "./cases.ts";
import { compare, describeComparison } from "./compare.ts";
import { RANDOM_SEED, V6Reference } from "./harness.ts";
import { WorkerSky } from "./worker-sky.ts";

// The same static matrix as the main-thread gate, with skye's core drawing in a dedicated worker. Chromium and
// Firefox must provide WebGL2 there; only WebKit may lack it (Safari before 17), and then skips with the reason.
const supported = await WorkerSky.supported();
const mayLack = server.browser === "webkit";

const UNSUPPORTED = "this engine gives no WebGL2 context to an OffscreenCanvas in a worker";

describe.each(SIZES)("worker parity with v6 at %ix%i", (width, height) => {
  let v6: V6Reference | undefined;
  let sky: WorkerSky | undefined;

  beforeAll(async () => {
    if (!supported && mayLack) return;
    v6 = await V6Reference.create(BASE, width, height);
    sky = await WorkerSky.create(BASE, width, height, RANDOM_SEED);
  });

  afterAll(() => {
    sky?.dispose();
    v6?.dispose();
  });

  it.for(CASES)("$scene at $name", async ({ scene, hour }, { skip }) => {
    if (v6 === undefined || sky === undefined) {
      skip(UNSUPPORTED);
      return;
    }
    const params = { ...BASE, scene, hour };
    v6.update(params);
    sky.update(params);
    const a = v6.frame(0);
    const b = await sky.frame(0);
    expect([b.width, b.height]).toEqual([a.width, a.height]);
    const result = compare(a.pixels, b.pixels, a.width, a.height);
    expect(result.pass, describeComparison(result)).toBe(true);
  });
});

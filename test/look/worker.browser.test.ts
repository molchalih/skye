import { afterAll, beforeAll, describe, it } from "vitest";
import { server } from "vitest/browser";
import { BASE, CASES, SIZES } from "./cases.ts";
import { expectApprovedLook } from "./expect.ts";
import { PageSky, RANDOM_SEED } from "./harness.ts";
import { WorkerSky } from "./worker-sky.ts";
import { NO_WORKER_WEBGL2, rendersInWorkers, workerWebGL2 } from "../support/worker-webgl2.ts";

// The same static matrix as the main-thread gate, with skye's core drawing in a dedicated worker and the approved
// build on the page. Chromium and Firefox must provide WebGL2 there; only WebKit may lack it, and then skips with the
// reason (test/support/worker-webgl2.ts).
const supported = rendersInWorkers(server.browser, await workerWebGL2());

describe.each(SIZES)("worker look at %ix%i, against the approved build", (width, height) => {
  let approved: PageSky | undefined;
  let sky: WorkerSky | undefined;

  beforeAll(async () => {
    if (!supported) return;
    approved = await PageSky.approved(BASE, width, height);
    sky = await WorkerSky.create(BASE, width, height, RANDOM_SEED);
  });

  afterAll(() => {
    sky?.dispose();
    approved?.dispose();
  });

  it.for(CASES)("$scene at $name", async ({ scene, name, hour }, { skip }) => {
    if (approved === undefined || sky === undefined) {
      skip(NO_WORKER_WEBGL2);
      return;
    }
    const params = { ...BASE, scene, hour };
    approved.update(params);
    sky.update(params);
    expectApprovedLook(await sky.frame(0), approved.frame(0), `${scene} at ${name}`);
  });
});

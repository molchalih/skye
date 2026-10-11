import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "vitest/browser";
import {
  collectErrors,
  coverOf,
  mount,
  nextEvent,
  record,
  unmountAll,
  until,
} from "../../test/support/element.ts";
import { wait } from "../../test/support/sky.ts";
import {
  NO_WORKER_WEBGL2,
  rendersInWorkers,
  workerWebGL2,
} from "../../test/support/worker-webgl2.ts";
import { SKYE_READY, defineSkye } from "../element/index.ts";

defineSkye();

// Both tests hold a sky compiling in the worker; without WebGL2 there the worker never compiles anything.
const WORKER_WEBGL2 = rendersInWorkers(server.browser, await workerWebGL2());

const COMPILES_SLOWLY = new URL("../../test/support/workers/compiles-slowly.ts", import.meta.url)
  .href;

const NativeWorker = Worker;
let made: CompilingWorker[] = [];

/** A worker that resolves `compiling` once the sky in it has polled its compile. */
class CompilingWorker extends NativeWorker {
  terminated = false;
  readonly compiling: Promise<void>;

  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    made.push(this);
    this.compiling = new Promise((resolve) => {
      this.addEventListener("message", (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (typeof data === "object" && data !== null && Reflect.get(data, "test") === "compiling")
          resolve();
      });
    });
  }

  override terminate(): void {
    this.terminated = true;
    super.terminate();
  }
}

/** The element's one worker, once its idle start has made it. */
async function only(): Promise<CompilingWorker> {
  await until(() => made.length > 0, "a worker");
  const [worker] = made;
  if (made.length !== 1 || worker === undefined) throw new Error(`${made.length} workers`);
  return worker;
}

beforeEach(() => {
  made = [];
  vi.stubGlobal("Worker", CompilingWorker);
});

afterEach(async () => {
  unmountAll();
  await wait(20);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("compiling in a worker", () => {
  it("keeps the gradient until the driver reports the programs done, then shows the sky", async ({
    skip,
  }) => {
    skip(!WORKER_WEBGL2, NO_WORKER_WEBGL2);
    const { el } = mount({ worker: COMPILES_SLOWLY, motion: "static", quality: "balanced" });
    const seen = record(el);
    const worker = await only();
    await worker.compiling;
    await wait(50);
    expect(seen).toEqual([]);
    expect(coverOf(el).hidden).toBe(false);
    worker.postMessage({ test: "compiled" });
    await nextEvent(el, SKYE_READY);
    expect(seen).toEqual([SKYE_READY]);
  });

  it("ends the worker without an event when removed mid-compile", async ({ skip }) => {
    skip(!WORKER_WEBGL2, NO_WORKER_WEBGL2);
    const { errors, stop } = collectErrors();
    const { el, box } = mount({ worker: COMPILES_SLOWLY, motion: "static" });
    const seen = record(el);
    const worker = await only();
    await worker.compiling;
    box.remove();
    await wait(50);
    stop();
    expect(worker.terminated).toBe(true);
    expect(el.stats()).toBeNull();
    expect(seen).toEqual([]);
    expect(errors).toEqual([]);
  });
});

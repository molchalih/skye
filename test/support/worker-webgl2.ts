// Whether this engine renders in workers at all: Chromium and Firefox give an OffscreenCanvas in a dedicated worker a
// WebGL2 context; WebKit may not (Safari before 17, and Playwright's WebKit on Linux), and skye then draws on the main
// thread instead. The worker tests run as written where the context exists; where it does not, a test about what the
// sky draws asserts that documented fallback, and a test that needs a running worker sky skips with NO_WORKER_WEBGL2.

/** The reason a test that needs skye drawing in a worker gives for skipping. */
export const NO_WORKER_WEBGL2 =
  "this engine gives no WebGL2 context to an OffscreenCanvas in a worker, so skye draws on the main thread";

/**
 * Resolves whether an `OffscreenCanvas` in a dedicated worker gets a WebGL2 context here. Self-contained, so a
 * Playwright page can run it too (`page.evaluate(workerWebGL2)` in test/consumers).
 */
export function workerWebGL2(): Promise<boolean> {
  const source =
    'let ok = false; try { ok = new OffscreenCanvas(1, 1).getContext("webgl2") !== null; } catch {} postMessage(ok);';
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(url);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<boolean>((resolve, reject) => {
    worker.addEventListener("message", (event: MessageEvent<unknown>) =>
      resolve(event.data === true),
    );
    worker.addEventListener("error", () => resolve(false));
    // A worker that never answers is a broken environment, not a missing context: fail with the reason.
    timer = setTimeout(
      () => reject(new Error("the WebGL2 worker probe got no answer within 10 s")),
      10_000,
    );
  }).finally(() => {
    clearTimeout(timer);
    worker.terminate();
    URL.revokeObjectURL(url);
  });
}

/**
 * The probe's answer for `engine`, which only WebKit may give as false: in Chromium or Firefox a missing context
 * would turn every worker test into a fallback test and hide the regression, so it fails instead.
 */
export function rendersInWorkers(engine: string, supported: boolean): boolean {
  if (!supported && engine !== "webkit")
    throw new Error(`${engine} gives no WebGL2 context to an OffscreenCanvas in a worker`);
  return supported;
}

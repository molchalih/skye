import type { SkyeParams } from "../../src/index.ts";
import type { Frame } from "./harness.ts";
import type { ParityReply, ParityRequest } from "./sky-worker.ts";

const REPLY_TIMEOUT_MS = 10_000;

/**
 * skye's core running in a dedicated worker on a canvas transferred to an
 * `OffscreenCanvas`, driven frame by frame like the main-thread harness and
 * read back in the worker.
 */
export class WorkerSky {
  private readonly worker: Worker;
  private readonly replies: ParityReply[] = [];
  private waiting: ((reply: ParityReply) => void) | undefined;

  private constructor() {
    this.worker = new Worker(new URL("./sky-worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (event: MessageEvent<ParityReply>) => {
      const waiting = this.waiting;
      this.waiting = undefined;
      if (waiting === undefined) this.replies.push(event.data);
      else waiting(event.data);
    });
  }

  /** Whether this engine gives an `OffscreenCanvas` in a dedicated worker a WebGL2 context. */
  static async supported(): Promise<boolean> {
    const probe = new WorkerSky();
    try {
      const reply = await probe.next();
      return reply.type === "probe" && reply.webgl2;
    } finally {
      probe.dispose();
    }
  }

  static async create(
    params: SkyeParams,
    cssWidth: number,
    cssHeight: number,
    seed: number,
    ratio = 1,
  ): Promise<WorkerSky> {
    const sky = new WorkerSky();
    const probe = await sky.next();
    if (probe.type !== "probe" || !probe.webgl2) throw new Error("no WebGL2 in the worker");
    const canvas = document.createElement("canvas").transferControlToOffscreen();
    const init: ParityRequest = {
      type: "init",
      canvas,
      params,
      width: cssWidth,
      height: cssHeight,
      ratio,
      seed,
    };
    sky.worker.postMessage(init, [canvas]);
    const ready = await sky.next();
    if (ready.type !== "ready")
      throw new Error(`worker sky did not start: ${JSON.stringify(ready)}`);
    return sky;
  }

  update(params: SkyeParams): void {
    this.post({ type: "update", params });
  }

  /** Draws one frame at animation time `t` in the worker and resolves with its pixels. */
  async frame(t: number): Promise<Frame> {
    this.post({ type: "frame", t });
    const reply = await this.next();
    if (reply.type !== "frame") throw new Error(`no frame: ${JSON.stringify(reply)}`);
    return reply;
  }

  dispose(): void {
    this.worker.terminate();
  }

  private post(request: ParityRequest): void {
    this.worker.postMessage(request);
  }

  private next(): Promise<ParityReply> {
    const queued = this.replies.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("the worker did not reply")),
        REPLY_TIMEOUT_MS,
      );
      this.waiting = (reply) => {
        clearTimeout(timer);
        resolve(reply);
      };
    });
  }
}

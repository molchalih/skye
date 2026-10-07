import type { SkyeStats } from "../core/api.ts";
import { Emitter } from "../core/emitter.ts";
import type { SkyeParams } from "../core/params.ts";
import type { SkyHost, SkyHostEvents } from "../element/host.ts";
import {
  isWorkerMessage,
  unhandled,
  type ErrorData,
  type HostMessage,
  type WorkerEvent,
} from "./protocol.ts";

// Kept in exactly this form: bundlers and dev servers recognise `new Worker(new URL("…", import.meta.url))` and
// emit or serve the worker module next to this one. Never a blob: URL, which `script-src 'self'` blocks.
function spawn(url: string): Worker {
  return url === ""
    ? new Worker(new URL("./worker.js", import.meta.url), { type: "module" })
    : new Worker(url, { type: "module" });
}

function toError(data: ErrorData): Error {
  const error = new Error(data.message);
  error.name = data.name;
  if (data.stack !== undefined) error.stack = data.stack;
  return error;
}

/**
 * A sky rendering in a dedicated worker. Until the worker reports that it can
 * render, the host keeps every call's state and the canvas stays here; then
 * the canvas is transferred with that state and later calls are forwarded.
 */
class WorkerHost implements SkyHost {
  private readonly canvas: HTMLCanvasElement;
  private readonly worker: Worker;
  private readonly events = new Emitter<SkyHostEvents>();
  private params: Partial<SkyeParams>;
  private size: readonly [number, number] | null = null;
  private dpr = 1;
  private visible = true;
  private reducedMotion: boolean;
  private started = false;
  /** The canvas belongs to the worker; calls are forwarded. */
  private attached = false;
  private ready = false;
  private failed = false;
  private disposed = false;
  private latest: SkyeStats | null = null;
  /** Pending until the worker answers the probe. */
  private probe: ReturnType<typeof setTimeout> | undefined;

  constructor(
    canvas: HTMLCanvasElement,
    worker: Worker,
    params: Partial<SkyeParams>,
    probeTimeoutMs: number,
  ) {
    this.canvas = canvas;
    this.worker = worker;
    this.params = { ...params };
    // A worker that loads but never answers (a URL serving some other module) would otherwise keep the sky from
    // ever starting. Only the probe is timed: once the canvas is transferred, a slow first frame is the worker's.
    this.probe = setTimeout(this.onProbeTimeout, probeTimeoutMs);
    // The core's own default, which the worker's scope cannot read.
    this.reducedMotion =
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    worker.addEventListener("message", this.onMessage);
    // Kept after dispose too: an error the worker raised just before it was dropped must not surface as uncaught.
    worker.addEventListener("error", this.onError);
    worker.addEventListener("messageerror", this.onMessageError);
  }

  update(params: Partial<SkyeParams>): void {
    this.params = { ...this.params, ...params };
    this.send({ type: "update", params });
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    this.size = [cssWidth, cssHeight];
    this.dpr = devicePixelRatio;
    this.send({ type: "resize", width: cssWidth, height: cssHeight, dpr: devicePixelRatio });
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.send({ type: "visible", on: visible });
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.send({ type: "motion", reduced });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.send({ type: "start" });
  }

  /** The worker's latest snapshot, or null before the first. */
  stats(): SkyeStats | null {
    return this.latest === null ? null : structuredClone(this.latest);
  }

  on<K extends keyof SkyHostEvents>(
    event: K,
    listener: (payload: SkyHostEvents[K]) => void,
  ): () => void {
    return this.events.on(event, listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.answered();
    this.send({ type: "dispose" });
    this.disposed = true;
    this.events.clear();
    // Terminating frees the worker's context with it, whether or not the worker got to the message.
    this.worker.terminate();
  }

  private send(message: HostMessage): void {
    if (this.attached && !this.disposed) this.worker.postMessage(message);
  }

  private attach(): void {
    if (this.attached || this.failed || this.disposed) return;
    let canvas: OffscreenCanvas;
    try {
      canvas = this.canvas.transferControlToOffscreen();
    } catch {
      this.fail();
      return;
    }
    this.attached = true;
    const init: HostMessage = {
      type: "init",
      canvas,
      params: this.params,
      size: this.size,
      dpr: this.dpr,
      reducedMotion: this.reducedMotion,
      visible: this.visible,
    };
    this.worker.postMessage(init, [canvas]);
    if (this.started) this.send({ type: "start" });
  }

  // Only before the first frame: from then on the sky is the worker's, and failing over would lose what it drew.
  private fail(): void {
    if (this.ready || this.failed || this.disposed) return;
    this.answered();
    this.failed = true;
    this.events.emit("unsupported", undefined);
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const message = event.data;
    if (this.disposed || !isWorkerMessage(message)) return;
    switch (message.type) {
      case "supported":
        this.answered();
        this.attach();
        break;
      case "unsupported":
        this.fail();
        break;
      case "ready":
        this.ready = true;
        this.events.emit("ready", undefined);
        break;
      case "stats":
        this.latest = message.stats;
        break;
      case "event":
        this.forward(message);
        break;
      default:
        unhandled(message);
    }
  };

  private forward(message: WorkerEvent): void {
    switch (message.name) {
      case "error":
        // Latched like the main thread's, so a listener added later still learns of the failure.
        this.events.latch("error", toError(message.detail));
        break;
      case "tierchange":
        this.events.emit("tierchange", message.detail);
        break;
      case "contextlost":
      case "contextrestored":
      case "webglcontextlost":
      case "webglcontextrestored":
        this.events.emit(message.name, undefined);
        break;
      default:
        unhandled(message);
    }
  }

  private answered(): void {
    clearTimeout(this.probe);
    this.probe = undefined;
  }

  private readonly onProbeTimeout = (): void => {
    this.probe = undefined;
    this.fail();
  };

  // A worker that cannot load (404, CSP, a module error) or start reports here. Cancelling keeps the error from
  // being reported as uncaught on the page, since the element falls back instead. After the first frame the sky
  // is the worker's: the error is reported as the sky's, and left to surface on the page like any uncaught one.
  private readonly onError = (event: Event): void => {
    if (!this.ready || this.disposed) {
      event.preventDefault();
      this.fail();
      return;
    }
    const message = event instanceof ErrorEvent ? event.message : "";
    this.events.latch("error", new Error(message === "" ? "skye: the worker failed" : message));
  };

  // A message that could not be read. Before the first frame the worker cannot be trusted to start; after it, the
  // loss is at most one stats snapshot or event.
  private readonly onMessageError = (): void => {
    this.fail();
  };
}

/**
 * A host rendering into `canvas` from a dedicated module worker loaded from
 * `url`, or from skye's own worker module when `url` is empty. Returns null
 * when this browser cannot render in a worker at all (no `Worker`, no
 * `transferControlToOffscreen`) or the worker cannot be constructed; the
 * canvas is then untouched. A worker that fails later, before its first
 * frame, or does not answer the probe within `probeTimeoutMs`, is reported
 * with the `unsupported` event; one that fails after it, with `error`.
 */
export function createWorkerHost(
  canvas: HTMLCanvasElement,
  params: Partial<SkyeParams>,
  url: string,
  probeTimeoutMs: number,
): SkyHost | null {
  if (typeof Worker !== "function" || typeof canvas.transferControlToOffscreen !== "function")
    return null;
  let worker: Worker;
  try {
    worker = spawn(url);
  } catch {
    return null;
  }
  return new WorkerHost(canvas, worker, params, probeTimeoutMs);
}

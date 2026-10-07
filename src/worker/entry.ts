import type { Sky } from "../core/api.ts";
import type { SkyeParams } from "../core/params.ts";
import { createSky } from "../core/renderer.ts";
import { getWebGL2 } from "../gl/context.ts";
import {
  isHostMessage,
  unhandled,
  type ErrorData,
  type HostMessage,
  type WorkerMessage,
} from "./protocol.ts";

/** At most four stats snapshots a second. */
const STATS_MS = 250;

/** The parts of a dedicated worker's global scope the worker side uses. */
export interface WorkerScope {
  postMessage(message: WorkerMessage): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

type Init = Extract<HostMessage, { type: "init" }>;

// The probe the page waits for before it gives up its canvas: once transferred, a canvas cannot go back.
function webgl2Available(): boolean {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
    if (gl === null) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function errorData(error: Error): ErrorData {
  return { name: error.name, message: error.message, stack: error.stack };
}

function loseContext(gl: WebGL2RenderingContext): void {
  if (!gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
}

/** The sky, or undefined when it cannot be built; the context it took is then freed. */
function build(
  canvas: OffscreenCanvas,
  gl: WebGL2RenderingContext,
  params: Partial<SkyeParams>,
): Sky | undefined {
  try {
    return createSky(canvas, params);
  } catch {
    loseContext(gl);
    return undefined;
  }
}

/** One sky on a transferred canvas, driven by the page's messages. */
class WorkerSky {
  private readonly scope: WorkerScope;
  private sky: Sky | undefined;
  private gl: WebGL2RenderingContext | undefined;
  private running = false;
  private visible = true;
  private ready = false;
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  /** Messages held back until the frame being waited for has drawn, so they reach the page in order. */
  private held: (() => void)[] | undefined;
  private frame: number | undefined;

  constructor(scope: WorkerScope) {
    this.scope = scope;
  }

  readonly onMessage = (event: MessageEvent<unknown>): void => {
    const message = event.data;
    if (!isHostMessage(message)) return;
    switch (message.type) {
      case "init":
        this.init(message);
        break;
      case "update":
        this.sky?.update(message.params);
        break;
      case "resize":
        this.sky?.resize(message.width, message.height, message.dpr);
        break;
      case "visible":
        this.visible = message.on;
        this.sky?.setVisible(message.on);
        this.pace();
        break;
      case "motion":
        this.sky?.setReducedMotion(message.reduced);
        break;
      case "start":
        this.running = true;
        this.sky?.start();
        this.pace();
        break;
      case "dispose":
        this.dispose();
        break;
      default:
        unhandled(message);
    }
  };

  private init(message: Init): void {
    if (this.sky !== undefined) return;
    const canvas = message.canvas;
    const gl = getWebGL2(canvas);
    const sky = gl === null ? undefined : build(canvas, gl, message.params);
    if (gl === null || sky === undefined) {
      // The page falls back to the main thread, which reports any failure it meets there itself.
      this.post({ type: "unsupported" });
      return;
    }
    this.sky = sky;
    this.gl = gl;
    // The element hides its gradient when it hears these; waiting for the frame they announce keeps the
    // gradient up until the canvas has something to show.
    sky.on("ready", () =>
      this.afterFrame(() => {
        this.ready = true;
        this.postStats();
        this.post({ type: "ready" });
        this.pace();
      }),
    );
    sky.on("contextrestored", () =>
      this.afterFrame(() => this.post({ type: "event", name: "contextrestored" })),
    );
    sky.on("error", (error) =>
      this.send({ type: "event", name: "error", detail: errorData(error) }),
    );
    sky.on("contextlost", () => this.send({ type: "event", name: "contextlost" }));
    sky.on("tierchange", (detail) => this.send({ type: "event", name: "tierchange", detail }));
    // The page times the browser's own restore, which comes before the sky's relink.
    const target: EventTarget = canvas;
    target.addEventListener("webglcontextlost", () =>
      this.send({ type: "event", name: "webglcontextlost" }),
    );
    target.addEventListener("webglcontextrestored", () =>
      this.send({ type: "event", name: "webglcontextrestored" }),
    );
    if (message.size !== null) sky.resize(message.size[0], message.size[1], message.dpr);
    sky.setReducedMotion(message.reducedMotion);
    this.visible = message.visible;
    sky.setVisible(message.visible);
  }

  private post(message: WorkerMessage): void {
    this.scope.postMessage(message);
  }

  /** Posts now, or after the messages already held back. */
  private send(message: WorkerMessage): void {
    if (this.held === undefined) this.post(message);
    else this.held.push(() => this.post(message));
  }

  // The sky requests its frame before it announces a change, so a frame callback requested now runs right after
  // that frame is drawn. Without frame callbacks in this scope the sky paces with timers; post at once.
  private afterFrame(run: () => void): void {
    if (this.held !== undefined) {
      this.held.push(run);
      return;
    }
    if (typeof requestAnimationFrame !== "function") {
      run();
      return;
    }
    this.held = [run];
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      const held = this.held ?? [];
      this.held = undefined;
      for (const next of held) next();
    });
  }

  // Snapshots only while the sky runs and can be seen.
  private pace(): void {
    const on = this.ready && this.running && this.visible;
    if (on && this.statsTimer === undefined) {
      this.statsTimer = setInterval(() => this.postStats(), STATS_MS);
    } else if (!on && this.statsTimer !== undefined) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
  }

  private postStats(): void {
    const sky = this.sky;
    if (sky !== undefined) this.post({ type: "stats", stats: { ...sky.stats(), worker: true } });
  }

  private dispose(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.held = undefined;
    clearInterval(this.statsTimer);
    this.statsTimer = undefined;
    this.sky?.dispose();
    this.sky = undefined;
    if (this.gl !== undefined) loseContext(this.gl);
    this.gl = undefined;
    this.scope.close();
  }
}

/**
 * Runs the worker side of worker rendering in `scope`: reports at once
 * whether an `OffscreenCanvas` can provide WebGL2 here, then builds a sky on
 * the canvas the page transfers with `init` and follows the page's messages.
 */
export function serve(scope: WorkerScope): void {
  const session = new WorkerSky(scope);
  scope.addEventListener("message", session.onMessage);
  scope.postMessage({ type: webgl2Available() ? "supported" : "unsupported" });
}

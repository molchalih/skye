import type { SkyeStats, TierChange } from "../core/api.ts";
import type { SkyeParams } from "../core/params.ts";

/**
 * Messages from the page to the worker. The page sends `init` once the worker
 * has reported `supported`, and nothing before it; everything after `init`
 * forwards one `Sky` call.
 */
export type HostMessage =
  | {
      type: "init";
      /** The element's canvas, transferred. */
      canvas: OffscreenCanvas;
      params: Partial<SkyeParams>;
      /** CSS width and height, or null while the element has no size yet. */
      size: readonly [number, number] | null;
      /** Device pixel ratio for `size`. */
      dpr: number;
      reducedMotion: boolean;
      visible: boolean;
    }
  | { type: "update"; params: Partial<SkyeParams> }
  | { type: "resize"; width: number; height: number; dpr: number }
  | { type: "visible"; on: boolean }
  | { type: "motion"; reduced: boolean }
  | { type: "start" }
  /** Asks for `drawn` with the same `id` once the page shows a frame drawn since. */
  | { type: "frame"; id: number }
  | { type: "dispose" };

/** An `Error` reduced to what crosses the thread boundary intact everywhere. */
export interface ErrorData {
  name: string;
  message: string;
  stack: string | undefined;
}

/**
 * Something the sky or the browser reported inside the worker. The
 * `webgl*` events are the canvas's own; the others are the sky's.
 */
export type WorkerEvent =
  | { type: "event"; name: "error"; detail: ErrorData }
  | { type: "event"; name: "tierchange"; detail: TierChange }
  | {
      type: "event";
      name: "contextlost" | "contextrestored" | "webglcontextlost" | "webglcontextrestored";
    };

/**
 * Messages from the worker to the page. The worker sends `supported` or
 * `unsupported` as soon as it has loaded, before any canvas is transferred.
 * After `init` it may still send `unsupported` if the sky cannot be built on
 * the transferred canvas.
 */
export type WorkerMessage =
  | { type: "supported" }
  | { type: "unsupported" }
  /** The sky drew its first frame. */
  | { type: "ready" }
  /** The answer to `frame`: the GPU has finished a frame drawn after the request. */
  | { type: "drawn"; id: number }
  /** A snapshot of the sky's stats, at most four a second while it runs and can be seen. */
  | { type: "stats"; stats: SkyeStats }
  | WorkerEvent;

// Each side trusts its counterpart to send only its own messages. This only keeps anything else posted to the same
// port (null, a primitive, another library's object) away from the switch, whose `default` ignores unknown types.
function hasType(data: unknown): boolean {
  return (
    typeof data === "object" && data !== null && "type" in data && typeof data.type === "string"
  );
}

/** Whether `data` has the shape of a message from the page: an object with a string `type`. */
export function isHostMessage(data: unknown): data is HostMessage {
  return hasType(data);
}

/** Whether `data` has the shape of a message from the worker: an object with a string `type`. */
export function isWorkerMessage(data: unknown): data is WorkerMessage {
  return hasType(data);
}

/** For the `default` of an exhaustive switch: fails to compile when a message type is not handled. */
export function unhandled(message: never): void {
  // A message of a type this side does not know is ignored, never thrown on.
  void message;
}

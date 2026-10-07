// A dedicated worker that renders skye on a transferred OffscreenCanvas frame by frame and posts the pixels back,
// for the parity gate's worker run. It drives the core directly, like the main-thread harness does.
import { createRandom } from "../../src/core/random.ts";
import { createSky, type Sky } from "../../src/index.ts";
import type { SkyeParams } from "../../src/index.ts";

/** Requests from the page; each but `update` gets exactly one reply. */
export type ParityRequest =
  | {
      type: "init";
      canvas: OffscreenCanvas;
      params: SkyeParams;
      width: number;
      height: number;
      ratio: number;
      seed: number;
    }
  | { type: "update"; params: SkyeParams }
  | { type: "frame"; t: number };

/** Replies to the page. `probe` is sent once on load. */
export type ParityReply =
  | { type: "probe"; webgl2: boolean }
  | { type: "ready" }
  | { type: "failed"; message: string }
  | { type: "frame"; width: number; height: number; pixels: Uint8Array };

let sky: Sky | undefined;
let gl: WebGL2RenderingContext | null = null;

function reply(message: ParityReply, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

function probe(): boolean {
  try {
    return new OffscreenCanvas(1, 1).getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

self.addEventListener("message", (event: MessageEvent<ParityRequest>) => {
  const request = event.data;
  try {
    if (request.type === "init") {
      const created = createSky(request.canvas, request.params, {
        random: createRandom(request.seed),
      });
      sky = created;
      gl = request.canvas.getContext("webgl2");
      created.on("ready", () => reply({ type: "ready" }));
      created.on("error", (error) => reply({ type: "failed", message: error.message }));
      created.resize(request.width, request.height, request.ratio);
    } else if (request.type === "update") {
      sky?.update(request.params);
    } else {
      if (sky === undefined || gl === null) throw new Error("no sky");
      sky.render(request.t);
      // The drawing buffer is not preserved, so it is read in the same task as the frame.
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      reply({ type: "frame", width, height, pixels }, [pixels.buffer]);
    }
  } catch (error) {
    reply({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  }
});

reply({ type: "probe", webgl2: probe() });

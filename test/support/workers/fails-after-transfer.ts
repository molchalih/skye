// skye's worker where the probe's 1x1 canvas gets WebGL2 but the transferred canvas does not, so the page learns
// the worker cannot render only after its canvas is gone.
import { serve } from "../../../src/worker/entry.ts";
import { patchMethod } from "./patch.ts";

patchMethod(OffscreenCanvas.prototype, "getContext", (canvas, _args, original) =>
  canvas.width === 1 ? original() : null,
);
serve(self);

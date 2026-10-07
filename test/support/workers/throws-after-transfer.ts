// skye's worker that crashes with an uncaught error once the canvas has been transferred.
import { serve } from "../../../src/worker/entry.ts";
import { patchMethod } from "./patch.ts";

patchMethod(OffscreenCanvas.prototype, "getContext", (canvas, _args, original) => {
  if (canvas.width !== 1) throw new Error("this worker crashes on the transferred canvas");
  return original();
});
serve(self);

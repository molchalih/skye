// skye's worker where every shader program fails to link on the transferred canvas, so the sky reports a ShaderError.
import { serve } from "../../../src/worker/entry.ts";
import { patchMethod } from "./patch.ts";

const LINK_STATUS = 0x8b82;

patchMethod(WebGL2RenderingContext.prototype, "getProgramParameter", (_gl, args, original) =>
  args[1] === LINK_STATUS ? false : original(),
);
serve(self);

// skye's worker in a scope whose OffscreenCanvas has no WebGL2, like Safari 16.4 to 16.6.
import { serve } from "../../../src/worker/entry.ts";
import { patchMethod } from "./patch.ts";

patchMethod(OffscreenCanvas.prototype, "getContext", () => null);
serve(self);

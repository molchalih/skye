// skye's worker with test controls. Requests carry a `test` key, which the worker side ignores like any message
// that is not its own:
// - { test: "frames" } replies { test: "frames", count } with the frames drawn so far (each frame rebuilds the
//   scene's mip chain exactly once);
// - { test: "lose" } and { test: "restore" } lose and restore the sky's context through WEBGL_lose_context;
// - { test: "junk" } posts the page messages that are not the protocol's;
// - { test: "crash" } throws an uncaught error in the worker.
import { serve } from "../../../src/worker/entry.ts";
import { JUNK } from "./junk.ts";
import { patchMethod } from "./patch.ts";

export type TestRequest =
  | { test: "frames" }
  | { test: "lose" }
  | { test: "restore" }
  | { test: "junk" }
  | { test: "crash" };

let frames = 0;
let loseContext: WEBGL_lose_context | null = null;

patchMethod(WebGL2RenderingContext.prototype, "generateMipmap", (_gl, _args, original) => {
  frames++;
  return original();
});

// The last WebGL2 context handed out is the sky's; the probe's comes first.
patchMethod(OffscreenCanvas.prototype, "getContext", (canvas, _args, original) => {
  const context = original();
  if (context instanceof WebGL2RenderingContext && canvas.width !== 1)
    loseContext = context.getExtension("WEBGL_lose_context");
  return context;
});

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data = event.data;
  const test: unknown =
    typeof data === "object" && data !== null ? Reflect.get(data, "test") : null;
  switch (test) {
    case "frames": {
      self.postMessage({ test: "frames", count: frames });
      break;
    }
    case "lose":
      loseContext?.loseContext();
      break;
    case "restore":
      loseContext?.restoreContext();
      break;
    case "junk":
      for (const message of JUNK) self.postMessage(message);
      break;
    case "crash":
      setTimeout(() => {
        throw new Error("the worker crashed");
      });
      break;
    default:
  }
});

serve(self);

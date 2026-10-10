// skye's worker on a driver that compiles in the background (KHR_parallel_shader_compile) and reports the programs
// done only once the page posts { test: "compiled" }. It posts { test: "compiling" } on the sky's first poll.
import { serve } from "../../../src/worker/entry.ts";
import { patchMethod } from "./patch.ts";

const COMPLETION_STATUS_KHR = 0x91b1;

let done = false;
let polled = false;

patchMethod(WebGL2RenderingContext.prototype, "getExtension", (_gl, args, original) =>
  args[0] === "KHR_parallel_shader_compile" ? { COMPLETION_STATUS_KHR } : original(),
);
patchMethod(WebGL2RenderingContext.prototype, "getProgramParameter", (_gl, args, original) => {
  if (args[1] !== COMPLETION_STATUS_KHR) return original();
  if (!polled) {
    polled = true;
    self.postMessage({ test: "compiling" });
  }
  return done;
});
self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (typeof data === "object" && data !== null && Reflect.get(data, "test") === "compiled")
    done = true;
});
serve(self);

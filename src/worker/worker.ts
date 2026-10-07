// The module `new URL("./worker.js", import.meta.url)` names: the worker side, started in the worker's scope.
import { serve } from "./entry.ts";

// Only a dedicated worker serves. Imported anywhere else (on a server, in a page by a bundler's dependency scan or a
// test) the module does nothing: a window would otherwise post the probe to itself.
const Dedicated: unknown = Reflect.get(globalThis, "DedicatedWorkerGlobalScope");
if (typeof Dedicated === "function" && globalThis instanceof Dedicated) serve(self);

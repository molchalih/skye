// Evaluated before the worker entry (see gpu-worker.ts): wraps every WebGL2 context the worker creates in a
// GlProbe and broadcasts its counters to the page a few times a second, without touching skye's own messages.
import { GlProbe } from "./gl-probe.ts";
import { CHANNEL } from "./gpu-protocol.ts";

const probes: GlProbe[] = [];
const probed = new WeakSet<WebGL2RenderingContext>();
/* oxlint-disable typescript/unbound-method, typescript/no-unsafe-type-assertion -- wraps an overloaded DOM method */
const getContext = OffscreenCanvas.prototype.getContext;
OffscreenCanvas.prototype.getContext = function (this: OffscreenCanvas, ...args: unknown[]) {
  const ctx: unknown = Reflect.apply(getContext, this, args);
  if (args[0] === "webgl2" && ctx instanceof WebGL2RenderingContext && !probed.has(ctx)) {
    probed.add(ctx);
    probes.push(new GlProbe(ctx));
  }
  return ctx;
} as typeof getContext;
/* oxlint-enable typescript/unbound-method, typescript/no-unsafe-type-assertion */

const channel = new BroadcastChannel(CHANNEL);
setInterval(() => {
  const calls: Record<string, number> = {};
  let frames = 0;
  for (const p of probes) {
    frames += p.framesDrawn;
    for (const [k, v] of p.calls) calls[k] = (calls[k] ?? 0) + v;
  }
  channel.postMessage({ frames, calls });
}, 100);

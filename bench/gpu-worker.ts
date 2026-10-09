// The worker URL the GPU bench gives `<skye-view worker>`: the counting hook first, then skye's own worker entry.
// oxlint-disable-next-line import/no-unassigned-import -- evaluated for its side effect, before the entry
import "./gpu-worker-hook.ts";
// oxlint-disable-next-line import/no-unassigned-import -- the worker entry starts itself
import "../src/worker/worker.ts";

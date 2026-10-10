---
"@a240/skye": patch
---

The sky no longer asks for a high-performance GPU, so on laptops with two GPUs it no longer wakes the discrete one. `createSky` alone can keep the old choice: it uses a context the canvas already has, so get one first with `powerPreference: "high-performance"` and skye's other attributes (`alpha`, `antialias`, `depth`, `stencil`, `premultipliedAlpha` and `preserveDrawingBuffer` all `false`). `<skye-view>`, React and worker mode always use the browser's default. The canvas has no depth or stencil buffer, which saves 20 to 44 MB of GPU memory at 2560×1440 and pixel ratio 2, and every sky on a page shares one noise lattice, so a second sky starts 2 ms sooner and a restored context 0.4 ms sooner.

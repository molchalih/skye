# @a240/skye

## 0.3.0

### Minor Changes

- d4f84c2: `skye-contextrestored` says whether the sky came back on a new canvas: its `detail` is now `{ replaced }`, true when the browser did not restore the context within `SkyeElement.restoreTimeoutMs` (or the sky moved between the worker and the main thread during the outage) and false when it restored the canvas it had. React's `onContextRestored` receives the same object. Types: the event's `detail` was `null` and is now the new `ContextRestored`, exported from `@a240/skye/element`. The core's `contextrestored` is unchanged, since a core sky always comes back on its own canvas.

### Patch Changes

- d4f84c2: `stats().fps` reads 0 while the sky is asleep (stopped, hidden, off screen or lost) or drawing static frames, instead of the rate of the last frames it animated, and measures afresh once it animates again. In worker mode the page's snapshot catches up when the worker stops sending them.

## 0.2.0

### Minor Changes

- cdfbf8c: Adds `quality="eco"`, an opt-in tier below `low` for battery-bound pages and background skies: the same sky, softer (a 0.75 pixel-ratio cap) and calmer (20 fps), at about 60 % of `low`'s GPU time per frame. `auto` never picks it, so no default image changes. Types: `Quality` and `Tier` gain `"eco"` (an exhaustive `switch` or a `Record<Tier, …>` needs the new case), `QUALITIES[1]` is now `"eco"`, and `TierChange.quality` narrows to the new `AutoTier` (low, balanced or high). Capped frame rates also keep a steady cadence on 144 and 165 Hz displays, where timestamp jitter could move a frame by one refresh.

### Patch Changes

- 93cd30a: Clouds, mist, the Milky Way and the glass frost read their noise from a precomputed texture, so the sky takes about half the GPU time it did. The clouds form a new pattern of the same kind.
- 06a8e92: The glass stays wet after a static frame when animation resumes, instead of drying and wetting again. Rain, frost and mist now build up on the glass smoothly rather than in quarter-second steps, so animated frames differ slightly while the look stays the same.
- 06a8e92: Static skies show the right frame on compositors that present a frame late. WebKit GTK and WPE can show a canvas one frame behind, so a static sky drew black at first and then the state before each change; each static frame is now drawn again on the next display frame, and the gradient goes a frame later, once the sky is on screen. `render(t)` callers who draw a single frame should draw it again on the next display frame.
- 4b241d6: Frames take up to 16 % less GPU time and allocate up to 90 % less JavaScript memory, and the background blur holds GPU memory only while it blurs (66 MB less at 2560×1440 and pixel ratio 2).
- 93cd30a: The sky no longer asks for a high-performance GPU, so on laptops with two GPUs it no longer wakes the discrete one. `createSky` alone can keep the old choice: it uses a context the canvas already has, so get one first with `powerPreference: "high-performance"` and skye's other attributes (`alpha`, `antialias`, `depth`, `stencil`, `premultipliedAlpha` and `preserveDrawingBuffer` all `false`). `<skye-view>`, React and worker mode always use the browser's default. The canvas has no depth or stencil buffer, which saves 20 to 44 MB of GPU memory at 2560×1440 and pixel ratio 2, and every sky on a page shares one noise lattice, so a second sky starts 2 ms sooner and a restored context 0.4 ms sooner.
- 93cd30a: Every entry is about 0.5 kB smaller to download (brotli), and one loaded from a CDN requests all its files at once.
- 93cd30a: Where the browser compiles shaders in the background, the sky notices that its shaders are ready within a few milliseconds instead of up to a frame later, so `ready` and the first frame come 10 to 15 ms sooner.
- 93cd30a: Fix `<skye-view worker>` holding back its events for good when the GPU never reports a frame as finished, as WebKit can after a lost context is restored: `skye-contextrestored` never arrived. The worker now waits about a second at most, and drops a frame's wait when the context is lost.

## 0.1.1

### Patch Changes

- The readme no longer says the package is unpublished.

## 0.1.0

### Minor Changes

- First release: a zero-dependency WebGL2 sky renderer, pixel-identical to the renderer it replaces. Entries: `skye` (`createSky`), `@a240/skye/element` and `@a240/skye/define` (`<skye-view>`), `@a240/skye/astro`, `@a240/skye/worker` (opt-in worker rendering) and `@a240/skye/react` (`<Skye>`).

<p align="center">
  <img alt="skye" src=".github/assets/logo.svg" width="100%" />
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="WebGL" src="https://img.shields.io/badge/webgl-%23990000.svg?style=for-the-badge&logo=webgl&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/vite-%23646CFF.svg?style=for-the-badge&logo=vite&logoColor=white" />
  <img alt="Bun" src="https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white" />
</p>

# @a240/skye

Welcome, guest! You've stumbled upon skyè, a zero-dependency WebGL2 sky renderer.

It's a rather small library with a rather large responsibility: rendering the entire sky inside a browser. Clouds, rain, stars, fog, and everything in between, all squeezed into a handful of shaders.

Crucially, no dependencies, no weather gods to appease. Just a tiny atmosphere you can call your own :)

[Try it live](https://molchalih.github.io/skye/): change the weather, time and place, then copy the markup.

## Install

```sh
npm install @a240/skye
```

| Entry                | What it is                                                           |
| -------------------- | -------------------------------------------------------------------- |
| `@a240/skye`         | `createSky(canvas, params, options)` and the types. No DOM access.   |
| `@a240/skye/define`  | Defines `<skye-view>` on import. For bundlers and CDN scripts.       |
| `@a240/skye/element` | `SkyeElement`, `defineSkye(tag)` and the attributes. No side effect. |
| `@a240/skye/react`   | `<Skye>` and `useSkyeStats`. Optional peer: `react` 19+.             |
| `@a240/skye/astro`   | Sun position, moon phase and day of year as pure functions.          |
| `@a240/skye/worker`  | The worker module, loaded for you in worker mode.                    |

## Quick start

### Element

```ts
import "@a240/skye/define";
```

```html
<div style="position: relative; height: 320px">
  <skye-view scene="rainy" hour="17.5" cover="0.7" intensity="0.8"></skye-view>
</div>
```

`<skye-view>` fills its nearest positioned ancestor, so give that ancestor a size. Every [param](#params) is an attribute; changing one eases the sky toward it.

```ts
const sky = document.querySelector("skye-view");
if (sky === null) throw new Error("no <skye-view> on the page");
sky.addEventListener("skye-tierchange", (e) => console.log(e.detail.quality));
sky.stats(); // a snapshot, or null before a sky is running
```

A complete page is in [`examples/vanilla.html`](examples/vanilla.html) (run `bun run build` first).

### CDN

Replace `<version>` with a release, such as `0.1.1`, and pin it in production:

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/@a240/skye@<version>/dist/define.js"
></script>
<!-- or -->
<script type="module" src="https://unpkg.com/@a240/skye@<version>/dist/define.js"></script>
```

`dist/define.js` loads four sibling files; jsDelivr's `/+esm` suffix serves it as one. Worker mode needs [an extra step](#worker-mode) from a CDN.

### Core

`createSky` draws into a canvas you own (`HTMLCanvasElement` or `OffscreenCanvas`) and throws without WebGL2.

```ts
import { createSky } from "@a240/skye";

const canvas = document.querySelector("canvas");
if (canvas === null) throw new Error("no <canvas> on the page");
const sky = createSky(canvas, { scene: "storm", hour: 21 });
sky.on("ready", () => console.log("drawing"));

sky.resize(canvas.clientWidth, canvas.clientHeight, devicePixelRatio); // the only source of size
sky.start(); // the sky's own requestAnimationFrame loop
sky.update({ scene: "snowy" }); // merge params; the sky eases toward them
```

To drive frames yourself, call `render(t)` (seconds) instead of `start()`, never both:

```ts
const frame = (ms: number) => {
  sky.render(ms / 1000);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
```

Also: `setVisible(visible)`, `setReducedMotion(reduced)`, `stats()`, `probe(on)`, `stop()`, `dispose()`. `on(event, handler)` returns an unsubscribe function. The `random` option replaces the lightning random source for reproducible frames.

`dispose()` frees the sky's GPU resources but leaves the context to the browser. Browsers cap live contexts per page, so if you create many skies on your own canvases, release each context too (`<skye-view>` does this for you):

```ts
sky.dispose();
canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
```

### React

```tsx
import { Skye } from "@a240/skye/react";

<div style={{ position: "relative", height: 320 }}>
  <Skye scene="rainy" hour={17.5} onReady={() => {}} onTierChange={(c) => console.log(c.quality)} />
</div>;
```

Props are the [param](#params) names, plus `worker`, `ref` (the element) and `onReady`, `onError`, `onContextLost`, `onContextRestored`, `onFallback`, `onTierChange`. Standard HTML attributes pass through to the element; `hidden` also pauses drawing. `useSkyeStats(ref, intervalMs)` polls `stats()` and returns `null` until a sky is running:

```tsx
import { useRef } from "react";
import type { SkyeElement } from "@a240/skye/element";
import { Skye, useSkyeStats } from "@a240/skye/react";

function Sky() {
  const ref = useRef<SkyeElement>(null);
  const stats = useSkyeStats(ref, 500);
  return (
    <div style={{ position: "relative", height: 320 }}>
      <Skye ref={ref} scene="rainy" />
      <output>{stats === null ? "starting" : `${stats.fps} fps`}</output>
    </div>
  );
}
```

### Time, date and the moon

skye never reads the clock: defaults are fixed, so the same markup always draws the same sky. `@a240/skye/astro` computes the real values:

```ts
import { dayOfYear, moonPhase, solarPosition } from "@a240/skye/astro";

const now = new Date();
const params = {
  hour: now.getHours() + now.getMinutes() / 60,
  dayOfYear: dayOfYear(now),
  moonPhase: moonPhase(now),
};
const { sunrise, sunset, elevationDeg } = solarPosition(52.37, params.dayOfYear, params.hour, 12.7);
```

`hour` is the local clock hour, read against the local clock time of `solarNoon`, not true solar time. (Unrelated to the Astro framework.)

## Worker mode

Add the `worker` attribute (or prop) to render on an `OffscreenCanvas` in a dedicated worker:

```html
<skye-view worker scene="storm"></skye-view>
```

- **Bundlers.** skye loads the worker with `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`, which Vite handles by itself.
- **CSP.** The worker is a real file, never `blob:`; allow it with `worker-src 'self'` (or `child-src`/`script-src` as fallbacks).
- **Custom URL.** `<skye-view worker="/assets/skye/worker.js">` loads that module instead. Workers must be same-origin, so a CDN page hosts skye's `dist/` itself and points here. A module containing only `import "@a240/skye/worker";` also works (in Vite: `import url from "./sky-worker.ts?worker&url"`).
- **Changes.** Toggling the attribute restarts the sky in the new mode, followed by `skye-ready`.
- **Fallback.** If the worker can't start, or doesn't answer within `SkyeElement.workerProbeTimeoutMs` (5000 ms), the sky renders on the main thread. A crash after the first frame fires `skye-error` and shows the gradient.
- **Which mode?** `stats().worker`. In worker mode, `stats()` refreshes up to four times a second.

## Params

One table for core, element and React. Bad values are clamped, wrapped or defaulted; nothing throws.

| Param       | Attribute     | Type / range                                                                  | Default  |
| ----------- | ------------- | ----------------------------------------------------------------------------- | -------- |
| `scene`     | `scene`       | `clear` `cloudy` `fog` `rainy` `storm` `sleet` `snowy` `haze` (else `cloudy`) | `cloudy` |
| `cover`     | `cover`       | 0 to 1                                                                        | `0.4`    |
| `intensity` | `intensity`   | 0 to 1. Rain, snow, fog or haze strength                                      | `0.6`    |
| `wind`      | `wind`        | number. Absent means the scene's own wind                                     | absent   |
| `seed`      | `seed`        | number. Cloud pattern                                                         | `0`      |
| `hour`      | `hour`        | local clock hour, 0 to 24 (wraps)                                             | `17.5`   |
| `latitude`  | `latitude`    | degrees, -66 to 66                                                            | `52.37`  |
| `dayOfYear` | `day-of-year` | 1 to 366                                                                      | `172`    |
| `solarNoon` | `solar-noon`  | local hour at which the sun is highest                                        | `12.7`   |
| `moonPhase` | `moon-phase`  | 0 to 1 (wraps). 0 is new, 0.5 is full                                         | `0.5`    |
| `glass`     | `glass`       | boolean. Rain on glass. Attribute `0`, `false`, `off` or `none` is off        | `true`   |
| `focus`     | `focus-depth` | 0.12 to 1. Glass focus depth                                                  | `0.45`   |
| `exposure`  | `exposure`    | 0.2 to 1.2. Overall brightness                                                | `1`      |
| `blur`      | `blur-radius` | CSS px, 0 to 64. Background blur                                              | `0`      |
| `quality`   | `quality`     | `auto` `low` `balanced` `high`. `auto` adapts to frame time                   | `auto`   |
| `motion`    | `motion`      | `auto` `full` `static`. See [reduced motion](#behaviour)                      | `auto`   |

`DEFAULTS` and `resolveParams` come from `@a240/skye`; `toAttributes(params)` from `@a240/skye/element`.

## Stats

`stats()` returns a snapshot; the element returns `null` before a sky is running.

| Field                 | Meaning                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `renderer`            | Always `"skye"`.                                                                               |
| `quality`, `auto`     | Tier in use, and whether it adapts.                                                            |
| `tier`                | The auto controller's tier index, 0 to 2 (kept at its last value under a fixed `quality`).     |
| `gpuMs`               | Smoothed GPU ms per frame, or -1. Needs a GPU timer and `quality="auto"` or `sky.probe(true)`. |
| `cpuMs`               | Smoothed CPU ms per frame, or -1 before the first.                                             |
| `fps`, `fpsCap`       | Frames drawn in the last second, and the loop's cap.                                           |
| `blur`                | Eased blur radius in CSS px.                                                                   |
| `out`, `sky`, `scene` | `[width, height]` of the canvas, the sky pass and the scene pass.                              |
| `mpx`, `passes`       | Megapixels shaded and draw passes in the last frame.                                           |
| `timer`               | Whether a GPU timer is available.                                                              |
| `hdr`                 | `"half-float"`, or `"rgba8"` without `EXT_color_buffer_float`.                                 |
| `static`              | Whether frames are static.                                                                     |
| `worker`              | Whether the sky renders in a worker.                                                           |

## Events

Element events bubble and cross shadow roots. Core events carry the same payloads without the `skye-` prefix.

| Element event          | Core event        | `detail`            | When                                                |
| ---------------------- | ----------------- | ------------------- | --------------------------------------------------- |
| `skye-ready`           | `ready`           | none                | Frames draw. Fires again after a mode change.       |
| `skye-error`           | `error`           | `Error`             | A shader failed to build, or the worker crashed.    |
| `skye-contextlost`     | `contextlost`     | none                | The WebGL context was lost; drawing stopped.        |
| `skye-contextrestored` | `contextrestored` | none                | Drawing again after a loss.                         |
| `skye-fallback`        | none              | none                | No WebGL2; the gradient stays.                      |
| `skye-tierchange`      | `tierchange`      | `{ quality, tier }` | The automatic tier changed (`quality="auto"` only). |

On the core, an unheard shader error is replayed to later listeners, or thrown once by the next `render()`.

## Behaviour

- **Lifecycle.** The element starts when the browser is idle (within 300 ms), pauses off screen, in hidden documents or when disconnected, and follows its size and pixel ratio.
- **Fallback.** A CSS gradient for the scene and hour shows until the sky is ready, or for good without WebGL2.
- **Context loss.** The sky rebuilds and resumes once the context is restored. The element replaces its canvas if that takes over `SkyeElement.restoreTimeoutMs` (3000 ms).
- **Reduced motion.** Under `prefers-reduced-motion: reduce`, `motion="auto"` draws one frame per change and idles. `static` always does; `full` never does. The core reads the query once; call `setReducedMotion(reduced)` for changes.
- **Several skies** on one page are independent.
- **Server rendering.** Every entry imports without a DOM; `@a240/skye/define` defines nothing there. `<Skye>` renders a bare `<skye-view>` and upgrades on the client.

## Browser support

| Engine       | From |
| ------------ | ---- |
| Safari, iOS  | 16.4 |
| Chrome, Edge | 111  |
| Firefox      | 101  |

All need WebGL2; without it the element shows the gradient and fires `skye-fallback`. Worker mode needs WebGL2 on `OffscreenCanvas` (Safari 17+); otherwise the sky renders on the main thread.

## Bundle size

Brotli at quality 11; 1 kB is 1000 bytes.

**Through your bundler** (`bun run size`):

| Entry               | Size    | Contents                               |
| ------------------- | ------- | -------------------------------------- |
| `@a240/skye`        | 17.0 kB | Core.                                  |
| `@a240/skye/define` | 20.1 kB | Element and core.                      |
| `@a240/skye/react`  | 20.7 kB | Component, element and core, no React. |

**From a CDN as published**, each file compressed on its own:

| Entry              | Files | Minified | Brotli  | gzip    |
| ------------------ | ----- | -------- | ------- | ------- |
| `dist/define.js`   | 5     | 64.4 kB  | 21.4 kB | 24.1 kB |
| `dist/index.js`    | 3     | 52.6 kB  | 17.5 kB | 19.7 kB |
| `dist/worker.js`\* | 4     | 56.0 kB  | 18.7 kB | 21.0 kB |

\* Only `worker.js` itself (1.2 kB brotli) is new; the rest the page already has.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

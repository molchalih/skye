# @a240/skye

A zero-dependency WebGL2 sky renderer. It draws weather scenes (clear, cloudy, fog, rain, storm, sleet, snow, haze) with clouds, sun, moon, stars, rain on glass and background blur. It has no runtime dependencies and works from plain HTML, any framework, or a worker.

skye is a pure renderer. It never reads the clock or the calendar and never fetches weather. You pass every input: the scene, the hour, the day of the year, the moon phase.

- [Install](#install)
- [Quick start](#quick-start)
- [Worker mode](#worker-mode)
- [Params](#params)
- [Stats](#stats)
- [Events](#events)
- [Behaviour](#behaviour)
- [Browser support](#browser-support)
- [Bundle size](#bundle-size)

## Install

skye is not published yet; these instructions apply once it is.

```sh
npm install @a240/skye
```

| Entry                | What it is                                                                             |
| -------------------- | -------------------------------------------------------------------------------------- |
| `@a240/skye`         | `createSky(canvas, params, options)` and the types. No DOM access.                     |
| `@a240/skye/define`  | Defines `<skye-view>` as a side effect. For bundlers and CDN scripts.                  |
| `@a240/skye/element` | `SkyeElement`, `defineSkye(tag)` and the attribute contract. No side effect on import. |
| `@a240/skye/react`   | `<Skye>` and `useSkyeStats`. `react` 19 or later is an optional peer.                  |
| `@a240/skye/astro`   | Sun position, moon phase and day of year as pure functions.                            |
| `@a240/skye/worker`  | The worker module. Loaded for you in worker mode.                                      |

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

`<skye-view>` fills its nearest positioned ancestor, so give that ancestor a size. Every [param](#params) is an attribute, and changing one eases the sky toward the new value. Listen for [events](#events) on the element:

```ts
const sky = document.querySelector("skye-view");
if (sky === null) throw new Error("no <skye-view> on the page");
sky.addEventListener("skye-tierchange", (e) => console.log(e.detail.quality));
sky.stats(); // a snapshot, or null before a sky is running; see "Stats"
```

A complete page is in [`examples/vanilla.html`](examples/vanilla.html). It needs `bun run build` first, because it loads `dist/define.js` through an import map.

### CDN

No bundler is needed. Replace `<version>` with a release, such as `0.1.0`:

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/@a240/skye@<version>/dist/define.js"
></script>
<!-- or -->
<script type="module" src="https://unpkg.com/@a240/skye@<version>/dist/define.js"></script>
```

Pin an exact version in production. `dist/define.js` loads four more files from beside it; jsDelivr's `/+esm` endpoint (`https://cdn.jsdelivr.net/npm/@a240/skye@<version>/dist/define.js/+esm`) serves it bundled into one. See [bundle size](#bundle-size) for what each costs, and [worker mode](#worker-mode) for the extra step a CDN needs.

### Core

`createSky` draws into a canvas you own. It works with an `HTMLCanvasElement` or an `OffscreenCanvas` and throws if the canvas cannot give a WebGL2 context.

```ts
import { createSky } from "@a240/skye";

const canvas = document.querySelector("canvas");
if (canvas === null) throw new Error("no <canvas> on the page");
const sky = createSky(canvas, { scene: "storm", hour: 21 });
sky.on("ready", () => console.log("drawing"));

// Size comes only from resize(): CSS size and device pixel ratio.
sky.resize(canvas.clientWidth, canvas.clientHeight, devicePixelRatio);

sky.start(); // the sky's own requestAnimationFrame loop
sky.update({ scene: "snowy" }); // merge params; the next frame eases toward them
```

To drive frames yourself, call `render(t)` with the animation time in seconds instead of `start()`. Use one way or the other, not both.

```ts
const frame = (ms: number) => {
  sky.render(ms / 1000);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
```

Other methods: `setVisible(visible)`, `setReducedMotion(reduced)`, `stats()`, `probe(on)`, `stop()`, `dispose()`. The `on(event, handler)` method returns an unsubscribe function. The core's `random` option replaces the lightning random source, which makes frames reproducible.

`dispose()` stops the sky and frees its GPU resources (programs, buffers, textures), but leaves the WebGL context to the browser, which frees it when the canvas is collected. Browsers cap live contexts per page and drop the oldest past the cap, so a page that creates and disposes many skies on canvases of its own should release each context at once:

```ts
sky.dispose();
canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
```

`<skye-view>` already does this when it disposes its sky.

### React

```tsx
import { Skye } from "@a240/skye/react";

<div style={{ position: "relative", height: 320 }}>
  <Skye scene="rainy" hour={17.5} onReady={() => {}} onTierChange={(c) => console.log(c.quality)} />
</div>;
```

Props are the [param](#params) names (not the attribute names), plus `worker`, `ref` and the callbacks `onReady`, `onError`, `onContextLost`, `onContextRestored`, `onFallback` and `onTierChange`. The `ref` is the element. Standard HTML attributes (`id`, `className`, `style`, `title`, `role`, `hidden` (which hides the element and pauses drawing), `tabIndex`, `aria-*`, `data-*` and DOM event handlers) go to the element as they would on any other; `onError` is skye's own. Boolean `aria-*` values are written as `"true"` or `"false"`. `useSkyeStats(ref, intervalMs)` polls `stats()` and returns `null` until a sky is running:

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

Defaults are fixed numbers, so the same markup always draws the same sky. `@a240/skye/astro` computes what to pass:

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

`hour` is clock time: the sun is placed by its distance from `solarNoon`, so pass the local clock hour and the local clock time of solar noon, not true solar time.

The helpers take dates as arguments and never read the clock. `dayOfYear` counts from the date's local calendar fields; v6's helper subtracted local midnights and came out one day short after a daylight-saving change (no pixels depend on this: v6 used it only for its clock default, which skye removed). This package is unrelated to the Astro web framework.

## Worker mode

Add the `worker` attribute (or the `worker` prop) and the sky renders on an `OffscreenCanvas` in a dedicated worker, off the main thread. It is opt-in.

```html
<skye-view worker scene="storm"></skye-view>
```

- **Bundlers.** Vite finds and emits the worker file by itself, because skye loads it with `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`. Other bundlers need to support that pattern.
- **CSP.** The worker is a real file, never a `blob:` URL, so it works under `script-src 'self'`. The policy must allow it through `worker-src 'self'`. Without a `worker-src` rule, browsers use `child-src` and then `script-src`.
- **URL override.** A non-empty attribute value is the URL of the worker module to load instead: `<skye-view worker="/assets/skye/worker.js">`. Use it when a bundler cannot find the worker, or when the page loads skye from a CDN. A worker must be same-origin with the page, so a CDN page has to host skye's `dist/` directory itself (the worker imports its sibling chunks) and point the attribute at `worker.js` there.
- **Your own worker module.** A module whose only line is `import "@a240/skye/worker";` serves as the worker; bundle it as a worker of your app (in Vite, `import url from "./sky-worker.ts?worker&url"`) and pass its URL in the attribute. The import does nothing outside a dedicated worker, so it is safe in code a server or a page also loads.
- **Changes.** Adding, removing or changing the attribute restarts the sky in the new mode, and a new `skye-ready` follows.
- **Fallbacks.** If the worker cannot run, the sky renders on the main thread with no uncaught error. That covers no `OffscreenCanvas` WebGL2, no `transferControlToOffscreen`, a worker that cannot be constructed, fails to load, throws, or fails before its first frame, and a worker that does not answer within `SkyeElement.workerProbeTimeoutMs` (5000 ms). A worker that crashes after its first frame is reported as `skye-error`, and the gradient returns.
- **Check which mode is running** with `stats().worker`. In worker mode `stats()` is the worker's latest snapshot, refreshed up to four times a second.

## Params

One table serves the core, the element and React. Out-of-range numbers are clamped or wrapped, and values that are not finite numbers fall back to the default. Nothing here throws.

**No default reads the clock.** The defaults for `hour`, `dayOfYear` and `moonPhase` are fixed numbers, so pass the real values (see [above](#time-date-and-the-moon)).

| Param       | Attribute     | Type / range                                                                  | Default  |
| ----------- | ------------- | ----------------------------------------------------------------------------- | -------- |
| `scene`     | `scene`       | `clear` `cloudy` `fog` `rainy` `storm` `sleet` `snowy` `haze` (else `cloudy`) | `cloudy` |
| `cover`     | `cover`       | 0 to 1                                                                        | `0.4`    |
| `intensity` | `intensity`   | 0 to 1. Rain, snow, fog or haze strength                                      | `0.6`    |
| `wind`      | `wind`        | number. Absent means the scene's own wind, scaled by intensity                | absent   |
| `seed`      | `seed`        | number. Cloud pattern                                                         | `0`      |
| `hour`      | `hour`        | local clock hour, 0 to 24 (wraps). Read against `solarNoon`, not solar time   | `17.5`   |
| `latitude`  | `latitude`    | degrees, -66 to 66                                                            | `52.37`  |
| `dayOfYear` | `day-of-year` | 1 to 366                                                                      | `172`    |
| `solarNoon` | `solar-noon`  | local hour at which the sun is highest                                        | `12.7`   |
| `moonPhase` | `moon-phase`  | 0 to 1 (wraps). 0 is new, 0.5 is full                                         | `0.5`    |
| `glass`     | `glass`       | boolean. Rain on glass. Attribute: `0`, `false`, `off` or `none` is off       | `true`   |
| `focus`     | `focus-depth` | 0.12 to 1. Glass focus depth                                                  | `0.45`   |
| `exposure`  | `exposure`    | 0.2 to 1.2. Overall brightness                                                | `1`      |
| `blur`      | `blur-radius` | CSS px, 0 to 64. Background blur                                              | `0`      |
| `quality`   | `quality`     | `auto` `low` `balanced` `high`. `auto` adapts to frame time                   | `auto`   |
| `motion`    | `motion`      | `auto` `full` `static`. See [reduced motion](#behaviour)                      | `auto`   |

The element has one more attribute, `worker`. Attribute names never collide with `HTMLElement` members. `DEFAULTS` and `resolveParams` are exported from `skye`, and `toAttributes(params)` from `@a240/skye/element` turns params into attributes.

## Stats

`sky.stats()` and `element.stats()` return a snapshot. The element returns `null` before a sky is running (before the idle start, or without WebGL2).

| Field                 | Meaning                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer`            | Always `"skye"`.                                                                                                                                                                              |
| `quality`, `auto`     | Tier in use (`low`, `balanced`, `high`), and whether it adapts (`quality="auto"`).                                                                                                            |
| `tier`                | The automatic controller's tier index, 0 to 2, as v6 reported it. Under a fixed `quality` it is not the tier in use: it keeps the controller's last value (1 until the controller has moved). |
| `gpuMs`               | Smoothed GPU ms per frame; -1 when not measured. Needs a GPU timer and `quality="auto"`, or `sky.probe(true)` on the core.                                                                    |
| `cpuMs`               | Smoothed CPU ms per frame drawn by the loop; -1 until one is drawn.                                                                                                                           |
| `fps`, `fpsCap`       | Frames drawn in the last second, and the loop's frame-rate cap.                                                                                                                               |
| `blur`                | Eased blur radius in CSS px.                                                                                                                                                                  |
| `out`, `sky`, `scene` | Buffer sizes as `[width, height]`: the canvas, the sky pass and the scene pass.                                                                                                               |
| `mpx`, `passes`       | Megapixels shaded and draw passes in the last frame.                                                                                                                                          |
| `timer`               | Whether a GPU timer is available.                                                                                                                                                             |
| `hdr`                 | HDR target storage: `"half-float"`, or `"rgba8"` without `EXT_color_buffer_float`.                                                                                                            |
| `static`              | Whether frames are static (`motion="static"`, or `auto` under reduced motion).                                                                                                                |
| `worker`              | Whether the sky renders in a worker.                                                                                                                                                          |

## Events

All element events bubble and cross shadow roots. Core events carry the same payloads, without the `skye-` prefix.

| Element event          | Core event        | `detail`            | When                                                                                   |
| ---------------------- | ----------------- | ------------------- | -------------------------------------------------------------------------------------- |
| `skye-ready`           | `ready`           | none                | Programs are linked and frames draw. Fires again after a mode change.                  |
| `skye-error`           | `error`           | `Error`             | A shader did not build, or a worker crashed after its first frame. The gradient stays. |
| `skye-contextlost`     | `contextlost`     | none                | The WebGL context was lost. Drawing stopped.                                           |
| `skye-contextrestored` | `contextrestored` | none                | Drawing again after a loss.                                                            |
| `skye-fallback`        | none              | none                | WebGL2 is unavailable. The gradient stays for good.                                    |
| `skye-tierchange`      | `tierchange`      | `{ quality, tier }` | The automatic tier changed (`quality="auto"` only).                                    |

On the core, a failed shader build is kept and replayed to listeners added later. If nothing is listening, the next `render()` throws it once.

## Behaviour

- **Lifecycle.** The element starts when the browser is idle (at most 300 ms later). It pauses while it is off screen, the document is hidden, or it is disconnected, and follows its size and the device pixel ratio. Removing it frees its WebGL context unless it is inserted again in the same task.
- **Fallback.** Until the sky is ready, and for good without WebGL2, the element shows a CSS gradient for the scene and hour, inside its shadow root.
- **Context loss.** The sky stops, waits for the browser to restore the context, rebuilds every GPU resource and resumes, keeping its detail scale and GPU-time average. On the element, if the browser does not restore the context within `SkyeElement.restoreTimeoutMs` (3000 ms), the element replaces its canvas and creates a new context. It dispatches `skye-contextlost`, then `skye-contextrestored`.
- **Reduced motion.** With `motion="auto"` (the default), `prefers-reduced-motion: reduce` makes the sky static: it draws one frame per change and is otherwise idle. `motion="static"` does this always, and `motion="full"` never. The element follows changes of the preference. On the core, call `setReducedMotion(reduced)`; it reads the media query once at creation.
- **Several skies on one page** are independent. Each owns its canvas and context.
- **Server rendering.** Every entry can be imported without a DOM. `@a240/skye/define` defines nothing there, so import it where it runs in the browser. `<Skye>` renders the bare `<skye-view>` tag on the server and upgrades on the client.

## Browser support

| Engine       | From |
| ------------ | ---- |
| Safari, iOS  | 16.4 |
| Chrome, Edge | 111  |
| Firefox      | 101  |

All three need WebGL2. Without it the element shows the gradient and dispatches `skye-fallback`. Worker mode needs WebGL2 on an `OffscreenCanvas`, which Safari has from 17; elsewhere the sky renders on the main thread.

## Bundle size

What a page downloads depends on how it loads skye. All figures are brotli-compressed at quality 11; 1 kB is 1000 bytes.

**Bundled by your bundler.** An app's bundler pulls each entry and the code it imports into its own output and minifies it. size-limit (`bun run size`) measures that:

| Entry               | Size    | Contents                                          |
| ------------------- | ------- | ------------------------------------------------- |
| `@a240/skye`        | 17.1 kB | The core.                                         |
| `@a240/skye/define` | 20.1 kB | Element and core.                                 |
| `@a240/skye/react`  | 20.6 kB | Component, element and core, with React external. |

**Loaded from a CDN as published.** `dist/` is minified, with external source maps that browsers fetch only when developer tools ask. Served as is, an entry is a chain of files, each compressed on its own:

| Entry              | Files | Minified | Brotli  | gzip    |
| ------------------ | ----- | -------- | ------- | ------- |
| `dist/define.js`   | 5     | 65.7 kB  | 21.4 kB | 23.8 kB |
| `dist/index.js`    | 3     | 54.2 kB  | 17.6 kB | 19.5 kB |
| `dist/worker.js`\* | 4     | 57.6 kB  | 18.8 kB | 20.8 kB |

\* All but `worker.js` itself (3.3 kB, 1.2 kB brotli) are the chunks the page has already loaded.

The five files of `dist/define.js` arrive in four rounds of requests, each file found only once the one before it has loaded. jsDelivr's `/+esm` endpoint (`https://cdn.jsdelivr.net/npm/@a240/skye@<version>/dist/define.js/+esm`) serves an entry bundled into a single file instead; it is not measured here. Worker mode from a CDN still needs `dist/` hosted on the page's own origin (see [worker mode](#worker-mode)).

v6, the renderer this replaces, is 14.0 kB measured by size-limit (14048 B), and 14136 B by the method of the original budget (esbuild 0.28.2 `--minify`, then brotli at quality 11). skye is larger because it adds context recovery, an error channel, typed events and stats, caller-driven frames and worker rendering. [`docs/tradeoffs.md`](docs/tradeoffs.md) has the measurements and the decision.

## Pixel parity

skye draws the same pixels as the renderer it replaces, and a test checks that in WebKit, Chromium and Firefox. [`docs/parity.md`](docs/parity.md) explains the gate. Changes that could alter pixels are proposed in [`docs/tradeoffs.md`](docs/tradeoffs.md) and are not applied without approval.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). `bun run bench` opens a benchmark page.

## License

MIT

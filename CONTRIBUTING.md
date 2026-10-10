# Contributing

## Setup

You need [Bun](https://bun.sh) 1.4.2 (the version in `packageManager`).

```sh
bun install
bunx playwright install webkit chromium firefox
```

The tests run in real browsers through Playwright, so all three engines must be installed.

On Linux, headless Firefox gets a WebGL context only when an X display is present; without one, every Firefox test that draws fails. Run the browser checks under Xvfb, as CI does: `xvfb-run --auto-servernum bun run check:browsers`. Firefox stays headless and draws through Mesa's llvmpipe; macOS needs nothing extra.

On Linux, Playwright's WebKit gives no WebGL2 context to an `OffscreenCanvas` in a worker, so it skips 76 worker cases by design (12 tests that need a worker sky and 64 worker look cases); its worker elements are tested on the main-thread fallback instead.

## Checks

`bun run check` is the gate. It runs `check:static`, then `check:browsers`, each step in this order:

| Step             | What it checks                                                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`           | oxlint with type-aware rules, after generating the shaders                                                                                                                                                                       |
| `typecheck`      | `tsc -b`, strict, over `src`, `scripts`, `test`, `bench` and `site`                                                                                                                                                              |
| `format:check`   | prettier (`bun run format` fixes it)                                                                                                                                                                                             |
| `test:unit`      | unit tests in Node                                                                                                                                                                                                               |
| `build`          | shader generation (unused functions dropped, short GLSL names and float literals, a uniform table per program), tsdown (minified, with source maps, each entry importing every chunk it needs), and the custom elements manifest |
| `check:package`  | publint (strict) and Are the Types Wrong? (ESM-only profile)                                                                                                                                                                     |
| `size`           | each entry against its limit in `.size-limit.json`                                                                                                                                                                               |
| `test:browser`   | browser tests in WebKit, Chromium and Firefox, then the worker tests, then the look gate                                                                                                                                         |
| `test:consumers` | the packed package from plain HTML with an import map, from a Vite app, from type-checked consumers, and beside the approved build                                                                                               |

While you work, run the part you need: `bun run test:unit`, `bun run test:browser`, `bun run test:consumers`.

Each limit in `.size-limit.json` is the entry's size when it was last set, rounded up with about 150 B to spare: three times the 40 to 50 B that an edit changing no behaviour can move brotli either way. A saving smaller than that is noise until it holds across several such edits; measure one against a handful of them before relying on it. When a change that is worth its bytes crosses a limit, raise the limit in the same change and say why in the pull request.

The shader build (`scripts/shaders.ts`) gives each program a uniform table, `SKY_UNIFORMS`, and each uniform a constant for where its value starts in the program's `values` array, `SKY_uTime`. A pass writes `values[glsl.SKY_uTime]`, so no uniform name reaches the bundle outside the table. Slots are typed by program and width: `values.set` takes a whole vector only into a slot of its own program that is as wide. `src/passes/uniforms.test.ts` checks what types cannot: that every pass names only its own program's slots, and that a component it writes by index (`glsl.SKY_uRes + 1`) stays within the uniform's width. An array uniform fails the build, since the table holds one value per uniform.

`SKYE_READABLE_SHADERS=1 bun run shaders` keeps the `.glsl` names and literals in the generated shaders, so a driver's info log is readable. Every command that regenerates them (`bun run site`, `bun run test:browser`) needs the variable too, and `size` fails while it is set.

`bun run bench` opens a benchmark page, a manual tool that `check` does not run. The stage defaults to 1280×960 CSS px; change it with `?w=` and `?h=`. The page prints a Markdown table (Tier, Mode, Scene, GPU ms, CPU ms, fps, Mpx, Method, Status) to paste into docs. In main-thread mode it drives the core with GPU timing on, so every tier has a GPU time; worker mode drives `<skye-view>`, which times the GPU only under `quality="auto"`.

`bun run site` serves the showcase page in `site/`, which, like the bench, imports skye from source; `bun run site:build` writes it to `site/dist`. The `pages` workflow builds it for every pull request that touches it and publishes it to GitHub Pages from `main` whenever the page, the renderer or the toolchain changes. The owner sets Pages to deploy from GitHub Actions once (Settings, Pages, Source).

### Runtime cost: `bun run bench:gpu`

`bun run bench:gpu` measures what the renderer costs to run on this machine, without a person at the page. It starts the bench's Vite server, drives Chromium through Playwright on the real GPU (ANGLE over Metal; headless Chromium otherwise falls back to SwiftShader, and the run stops if it does), and writes `results.json`, `report.md` and one PNG per case to `bench/results/<timestamp>/` (ignored by git). `--quick` runs one small case in about a minute; the full matrix takes 15 to 20 minutes. The options are listed at the top of `bench/gpu-run.ts`.

It runs these sections:

- **Startup.** The core is bundled into one minified module and imported into fresh pages. The section records import time, `createSky`, time to ready (shader compile and link), time to the first frame read back, and the main-thread time the sky takes before it can draw: the `createSky` call plus every compile poll, with the longest task and any long tasks. Cold runs use a new browser, so the GPU program cache is empty; warm runs use a new page in that browser.
- **Matrix.** Scenes × tiers × CSS sizes × pixel ratios, each a sky driven with `render(t)` at t = i/60. The fixed times make every run draw the same frames.
- **Element.** A real `<skye-view>`, on the main thread and in a worker, running its own loop in five states: visible, offscreen, hidden, static and reduced motion.

The bench instruments the context from outside the renderer. `bench/gl-probe.ts` wraps the WebGL2 context before `createSky` receives it. Nothing in `src/` changes. The matrix attributes the proxy's own allocations to the harness, and the element section takes its allocation sample and trace from a fresh, uninstrumented element.

| Axis   | Figures                                                                                                                                                                                                | Source                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| GPU    | Paced GPU ms per frame (p50/p95/p99); saturated ms per frame; per pass: one query per pass, and marginal cost; ioreg device, renderer and tiler utilisation                                            | `EXT_disjoint_timer_query_webgl2` (TIME_ELAPSED; TIMESTAMP has 0 bits); back-to-back frames timed to a one-pixel read; `ioreg -c IOAccelerator` |
| CPU    | `render()` ms (p50/p95/p99, 5 µs timers through cross-origin isolation); frame intervals and dropped frames; long tasks; main-thread task and script share; CPU per Chromium process; thread busy time | `performance.now`, `PerformanceObserver`, DevTools `Performance.getMetrics`, `ps`, DevTools `SystemInfo`, a Chrome trace                        |
| GL     | Calls per frame by method and group: draws, program switches, uniforms, bindings, state, uploads, sync-capable                                                                                         | Counting proxy on the context                                                                                                                   |
| Memory | Render-target, buffer and canvas bytes; JS heap; sampled allocations per frame, split into renderer, harness and other; GC count and pause; process RSS; GPU memory in use                             | Wrapped `texImage2D`/`bufferData`, `performance.memory`, the sampling heap profiler, the trace, `ps`, ioreg                                     |
| Energy | `top`'s POWER (Activity Monitor's energy impact) summed over Chromium's processes; thermal state                                                                                                       | `top -stats pid,cpu,power`, `pmset -g therm`                                                                                                    |

Read these figures with their limits:

- **Paced and saturated GPU time measure different things.** Apple GPUs clock down under light load. Paced GPU time is how long the GPU stays busy per frame at that lower clock, so it tracks energy. Saturated ms per frame is the cost at full clock, so it tracks throughput.
- **Per-pass queries rank passes but do not add up.** A query per pass splits the frame into separate submissions, so small passes read high and the sum exceeds the whole frame.
- **The marginal cost is each pass's own cost at full clock.** It repeats the pass's draws 6 and then 12 times, with a flush between repeats, and takes the slope. The flush is needed because hidden-surface removal would otherwise drop repeated opaque draws. The marginal costs add up to about the saturated frame.
- **ioreg and `top` cover the whole system.** The report shows an idle window from before the run and one from after it; the gap between them is the noise floor.
- **Hidden is emulated.** The bench overrides `document.visibilityState`, so the browser's own throttling of hidden tabs is not exercised.
- **Worker allocations are not sampled.** The profiler sees only the page's heap.

Some measurements need root or Xcode, and the bench does not take them:

- **GPU and CPU power in watts:** `sudo powermetrics --samplers gpu_power,cpu_power -i 500` during a run.
- **A Metal System Trace:** `xcrun xctrace record --template 'Metal System Trace' --attach <GPU process pid>`. It needs a full Xcode install.

`--baseline <dir>` compares a run with an earlier one. Each reference frame is checked under the look gate's limits against the approved build ([Look preservation](#look-preservation)), and the report gives the change in GPU and CPU time.

## Look preservation

skye must keep its look: the same sky, colours, light, motion and character. Its pixels may change; what a person sees may not, unless the owner approves it. The look gate in `test/look/` holds every change to that, in WebKit, Chromium and Firefox. Its references draw beside skye in the same page, on the same GPU, at the same size and pixel ratio, with the same params, animation times and random sequence:

- **The approved build**, `test/reference/skye-approved.js`: skye's core bundled from the tree whose look the owner last approved. Every case is held to it, tightly: the static matrix (every scene at night, dawn, noon and dusk, in two boxes), animation, lightning, scene changes, resizes, blur fades, every tier, focus and exposure limits, wind, pixel ratios, the RGBA8 fallback, the worker, the element, and the published build (`test:consumers`).
- **The frozen baseline**, `test/reference/skye-baseline-2026-10.js`: the approved build as of 2026-10-10, which never changes (`test/reference/reference.test.ts` pins its bytes). The static matrix is held to it, more loosely, so that approvals one after another cannot drift far from it.

v6 (`test/reference/weather-sky-v6.js`, unchanged) is no longer compared image to image: its clouds, mist and frost sit elsewhere than skye's, which read a noise texture, so it could only be held to loose limits that let a sky 10 % brighter, stars off or rays off through. It stays the reference for the frame state, lightning, layout, blur kernel and solar math (`src/core/*.browser.test.ts`, `src/core/blur-kernel.test.ts`, `src/astro/`), compared to float32 precision (4 ulp) with pixel sizes, flags and strike times exact; the easing is held to its own behaviour (`src/core/easing.test.ts`), and it times the storm cases to its lightning schedule.

Colours are compared in OKLab, scaled by 100 (lightness 0 to 100; a just-noticeable difference is about 2), from means only, never single pixels:

| Measure                                                                             | Approved | Baseline | Catches                                                    |
| ----------------------------------------------------------------------------------- | -------- | -------- | ---------------------------------------------------------- |
| mean colour of the whole frame                                                      | 0.05     | 0.15     | brightness, hue, exposure, tone mapping, however slight    |
| mean colour of each region of a 16 × 16 grid                                        | 0.5      | 0.6      | what moves or vanishes in one place: sun, stars, rays, fog |
| 99th percentile over the frame's 2 × 2 blocks                                       | 2        | 3        | a change of structure: the drops, a pattern, a flip        |
| detail: mean lightness gradient of each region of an 8 × 8 grid, change ÷ (max + ¼) | 0.15     | 0.2      | a blur, a lower resolution, fewer bits                     |

How the limits were set, over the static matrix in all three engines (192 frames): every float uniform jittered by 1e-4 of its value, far more than any reordering of float32 arithmetic, reaches at most 0.01, 0.28, 0.93 and 0.08, under half of each limit. The approved limits catch, in the cases where each shows: a sky 3 % brighter (frame 0.11 to 0.53), exposure × 1.05, a 3 % hue turn, the sun 3 px higher, cloud cover + 0.05, fog, stars, frost, rain, refraction or rays off, a missing pass, another tone mapping or tier, a flip, wind × 2, a frozen clock, 2 × 2 pixelation on or off the blocks and a 3 × 3 blur. 6-bit output is caught only where the sky has a smooth gradient (93 of 192 frames against the approved build, 30 against the baseline); elsewhere 6 bits change too little to measure. A shift of one 8-bit step over the whole frame fails, since a sky 3 % brighter is about that much. The baseline limits sit 1.2 to 3 times higher and still stop a sky 10 % brighter, stars off, rays off and cover + 0.05; stars off only just (region 0.70 against 0.6, 1.16 ×). `test/look/gate.browser.test.ts` runs a case of each regression (`test/look/mutations.ts`) and of the noise in every engine on every run, and `test/look/compare.test.ts` the measures themselves.

The gate compares exact cloud, star and grain patterns, so the hash functions and the noise lattice must stay as they are unless a change to the look is approved.

- **Any change that keeps the gate passing needs no approval of its look:** a refactor, a reordering of arithmetic, a rewrite of a shader or of the frame math.
- **A change that fails the gate is a bug, unless it is meant to change the image.** Then it needs the owner's eye. Propose it in an issue with its measured gain, the gate's figures (a failure prints every measure and the worst region) and screenshots of skye and the approved build side by side. Examples: fewer particles, fewer ray taps, lower precision, fewer octaves, another noise.
- **Once the owner approves it,** run `bun run look:approve`, which bundles the working tree into `test/reference/skye-approved.js` and its declarations, and commit both in the commit that makes the change. CI checks that every commit changing them holds exactly its own source, bundled (`scripts/check-approved.ts`), and `.github/CODEOWNERS` puts `test/reference/` under the owner's review.
- **A deliberate change to the look usually needs a new baseline too,** since the baseline limits are only 1.2 to 3 times the approved ones. That is a separate step, by the owner's decision: copy `test/reference/skye-approved.js` and `.d.ts` to `skye-baseline-<yyyy-mm>.*`, point `PageSky.baseline` (`test/look/harness.ts`) at them, pin their SHA-256 in `test/reference/reference.test.ts`, and delete the old pair.
- **`scripts/check-approved.ts` survives a force-push:** when its base is gone it checks the approval in force (HEAD's last commit to change the approved build), and when the base still exists off HEAD's history it checks every commit since the two parted; its log names the range. It can still fail falsely when a dependency bump follows a checked approval commit (the approval is rebuilt with HEAD's dependencies); squashing the approval with the bump, or approving again after it, fixes that.
- **`.github/CODEOWNERS` blocks a merge only** if branch protection on `main` requires a code owner's review; the owner sets that once.
- **Never edit a reference by hand, and never raise a limit to make a case pass.**

To run the gate alone: `bunx vitest run --project browser --project browser-worker --project browser-look test/look`. To add a case, use `LookPair` from `test/look/harness.ts` and `expectLook` from `test/look/expect.ts`, and add only cases that reach a code path no existing case reaches: each adds time to every run in three browsers.

## Code rules

- **No default may read the clock or the calendar.** Callers pass time and date.
- **Per-frame code allocates nothing.** No number passes to or returns from a call in the frame path, a value merged with a constant by a conditional expression is stored by a branch instead, and no built-in that allocates (`Array.prototype.fill`, an iterator) runs per frame: V8 boxes each such number, and its optimising tier inlines a call only within a budget. `src/core/allocation.browser.test.ts` holds frames under a byte each in Chromium. Until V8 has optimised the frame path the engine itself allocates, for roughly the first 25 s of animation and briefly again around 5 to 6 min, as it recompiles; that is the engine, not the code. The test warms up for 60,000 frames and takes the least of three sampled windows, so neither shows in it.

## Commits

Conventional commits:

```
type(scope): description
```

- `type` is one of `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`. A change that fits none of them is usually two changes.
- The description is lowercase, imperative, has no trailing period, and keeps the subject under 72 characters: `feat(element): add the worker attribute`.
- The body is empty. Reasoning belongs in a code comment, in the docs, or in the pull request.
- One logical change per commit. A commit that only fixes the previous one is amended into it before pushing.

## Releases

Releases use [Changesets](https://github.com/changesets/changesets) and publish from CI through npm trusted publishing, with provenance. Nothing is published by hand.

1. A change that users can see adds a changeset with `bun run changeset`. Pick the bump (`patch`, `minor` or `major`) and describe the change for a reader of the changelog. Commit the generated file in `.changeset/` with the change.
2. Run the `release` workflow on `main` (Actions, release, Run workflow). With changesets pending it opens a "version packages" pull request that bumps `package.json`, writes `CHANGELOG.md` and removes the consumed changesets.
3. Review and merge that pull request, then run the `release` workflow on `main` again. With no changesets pending it publishes the new version to npm and tags it.

The workflow runs only from `main` and through the `npm` environment, which the package's trusted publisher on npm names. While the version is below 1.0.0, a breaking change is a `minor` bump. `changeset status` compares against the `main` branch.

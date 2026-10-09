# Contributing

## Setup

You need [Bun](https://bun.sh) 1.4.2 (the version in `packageManager`).

```sh
bun install
bunx playwright install webkit chromium firefox
```

The tests run in real browsers through Playwright, so all three engines must be installed.

## Checks

`bun run check` is the gate. It runs `check:static`, then `check:browsers`, each step in this order:

| Step             | What it checks                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `lint`           | oxlint with type-aware rules, after generating the shaders                                                         |
| `typecheck`      | `tsc -b`, strict, over `src`, `scripts`, `test`, `bench` and `site`                                                |
| `format:check`   | prettier (`bun run format` fixes it)                                                                               |
| `test:unit`      | unit tests in Node                                                                                                 |
| `build`          | shader generation with short GLSL names, tsdown (minified, with source maps), and the custom elements manifest     |
| `check:package`  | publint (strict) and Are the Types Wrong? (ESM-only profile)                                                       |
| `size`           | each entry against its limit in `.size-limit.json`                                                                 |
| `test:browser`   | browser tests in WebKit, Chromium and Firefox, then the worker tests; includes the pixel parity gate               |
| `test:consumers` | the packed package from plain HTML with an import map, from a Vite app, from type-checked consumers, and beside v6 |

While you work, run the part you need: `bun run test:unit`, `bun run test:browser`, `bun run test:consumers`.

`SKYE_READABLE_SHADERS=1 bun run shaders` keeps the `.glsl` names in the generated shaders, so a driver's info log is readable. Every command that regenerates them (`bun run site`, `bun run test:browser`) needs the variable too, and `size` fails while it is set.

`bun run bench` opens a benchmark page, a manual tool that `check` does not run. The stage defaults to 1280×960 CSS px; change it with `?w=` and `?h=`. The page prints a Markdown table (Tier, Mode, Scene, GPU ms, CPU ms, fps, Mpx, Method, Status) to paste into docs. In main-thread mode it drives the core with GPU timing on, so every tier has a GPU time; worker mode drives `<skye-view>`, which times the GPU only under `quality="auto"`.

`bun run site` serves the showcase page in `site/`, which, like the bench, imports skye from source; `bun run site:build` writes it to `site/dist`. The `pages` workflow builds it for every pull request that touches it and publishes it to GitHub Pages from `main` whenever the page, the renderer or the toolchain changes. The owner sets Pages to deploy from GitHub Actions once (Settings, Pages, Source).

### Runtime cost: `bun run bench:gpu`

`bun run bench:gpu` measures what the renderer costs to run on this machine, without a person at the page. It starts the bench's Vite server, drives Chromium through Playwright on the real GPU (ANGLE over Metal; headless Chromium otherwise falls back to SwiftShader, and the run stops if it does), and writes `results.json`, `report.md` and one PNG per case to `bench/results/<timestamp>/` (ignored by git). `--quick` runs one small case in about a minute; the full matrix takes 15 to 20 minutes. The options are listed at the top of `bench/gpu-run.ts`.

It runs these sections:

- **Startup.** The core is bundled into one minified module and imported into fresh pages. The section records import time, `createSky`, time to ready (shader compile and link), and time to the first frame read back. Cold runs use a new browser, so the GPU program cache is empty; warm runs use a new page in that browser.
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

`--baseline <dir>` compares a run with an earlier one. Each reference frame is checked under the parity gate's tolerance (at least 99.9 % of channels within 1/255, and none beyond 4/255), and the report gives the change in GPU and CPU time.

## Pixel parity

skye draws exactly what the renderer it replaces (v6) draws. v6's source is kept unchanged in `test/reference/weather-sky-v6.js`, and the parity gate renders both side by side.

- **When a parity case fails, fix the divergence in skye.** Never edit the reference file and never loosen the tolerance.
- **A change that could alter pixels does not go into code.** Propose it in an issue with its measured gain and parity diff. It is applied only after the owner approves that item. This covers fewer particles, fewer ray taps, lower precision, skipped mipmaps, lower octave caps and any shader change beyond stripping comments and whitespace and shortening names.
- **No default may read the clock or the calendar.** Callers pass time and date.
- **Per-frame code allocates nothing.**

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

# Trade-offs

Decisions where skye gives something up, with the measurements behind them. Changes that could alter pixels are proposed here and applied only after the owner approves each one.

## Recorded decisions

### Core bundle size: above v6's

**Status:** recorded for the owner's review. The size check holds the core at the size it had when this was measured.

The budget asked that `skye` (the core entry: `createSky`, params, types) stay within v6's minified, brotli-compressed size. It does not. All figures are minified, then compressed with brotli at quality 11.

|                                                         | esbuild 0.28.2 (the method of the original baseline) | size-limit 14.1.0 (rolldown) |
| ------------------------------------------------------- | ---------------------------------------------------- | ---------------------------- |
| v6, the whole element                                   | 14136 B                                              | 14048 B                      |
| `skye` (core only)                                      | 17193 B (+3057 B, +21.6%)                            | 17098 B                      |
| `skye/define` (element and core: what a CDN user loads) | 20050 B                                              | 19956 B                      |
| `skye/react` (React external)                           | 20566 B                                              | 20389 B                      |

**Where the bytes are** (esbuild, minified / brotli):

| Part        | v6             | skye core       |
| ----------- | -------------- | --------------- |
| Shader text | 20652 / 6236 B | 18046 / 5780 B  |
| JavaScript  | 22170 / 7941 B | 35980 / 11408 B |

The shaders are smaller, because comments and redundant whitespace are stripped. The JavaScript is about half as large again. v6's figure also covers its whole element, while the core's has no element at all.

**What skye has that v6 lacked.** None of these can be removed without dropping behaviour the spec requires:

- **Context recovery:** a sky survives a lost context, rebuilds every GPU resource and keeps its detail scale and GPU-time average. It reports the loss and the restore as events.
- **An error channel:** a failed shader build is kept and replayed to listeners subscribed later, or thrown once by `render` when nobody listens. v6 left a blank canvas.
- **Caller-driven frames:** `render(t)` with its own frame interval, beside the internal loop, with the loop's pacing, frame-rate cap and visibility gating as a separate unit.
- **Typed events and stats:** an emitter and `stats()`, which reports tier, timings, buffer sizes, passes, timer and HDR storage.
- **Off-thread rendering:** the core runs on an `OffscreenCanvas` in a worker as well as on the page.
- **Zero per-frame allocation:** uniforms are uploaded only when their value changes, through a location cache with per-uniform dirty checks.
- **A seeded random source** for lightning, so frames are reproducible.

**Readable names.** The rest of the difference comes from readable names that no minifier may rename. Examples are frame-state fields such as `sinElevation` and `weatherExposure`, and layout fields such as `sceneWidth` and `canvasHeight`. v6 used short names. Private class members are ES `#names`, which minifiers do shorten. About 8.5 KB of the minified core is still `.name` property text.

**What a size pass could still save,** measured on the minified core:

| Change                                                                                      | Saving (brotli)         | Status                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private class members as ES `#names`, which minifiers shorten                               | 589 B (17782 → 17193 B) | Applied: a mechanical rename, and parity stays bit-identical                                                                                         |
| Uniform names declared once instead of twice per pass                                       | 198 B                   | Not applied: the typed helper needs an unchecked type assertion in core code                                                                         |
| Every remaining internal property shortened by a build-time rule                            | about 350 B at most     | Not applied: it needs a naming convention on every internal member, and a rule that must never match public, stats, uniform or worker-protocol names |
| Every remaining property shortened, including WebGL's own (impossible; an upper bound only) | 813 B                   | —                                                                                                                                                    |

Even every remaining item together leaves the core more than 2.5 KB over v6's size, so those were not applied: each costs more in code or risk than its share of a gap it cannot close.

**The decision to take.** One option is to accept the larger core for the behaviour above; the size check (`bun run size`) then holds it at 17.25 kB. The other is to ask for a restructuring of the core aimed at size. That would be its own piece of work, with its own parity run.

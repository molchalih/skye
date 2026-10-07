# Trade-offs

Decisions where skye gives something up, with the measurements behind them. Changes that could alter pixels are proposed here and applied only after the owner approves each one.

- [The ledger](#the-ledger): pixel-affecting changes, proposed and not applied
- [Recorded decisions](#recorded-decisions): decisions taken, with their measurements

## The ledger

skye draws exactly what v6 draws, and the parity gate (`docs/parity.md`) holds it to that. A change that could alter pixels is not made in code. It is written here first, measured, and applied only after the owner approves that item.

### Ledger format

One row per item.

| Column        | What it holds                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item          | The change, in one line, with the code it touches.                                                                                                          |
| Expected gain | What the change should save, before measuring: which cost, and where.                                                                                       |
| Measured gain | From `bun run bench`: GPU ms, CPU ms and Mpx per tier and scene, before and after, with the device and the date. `not measured` until then.                 |
| Parity diff   | From the parity run with the change applied: the share of channels beyond 1/255 and the largest difference, per case that moved. `not measured` until then. |
| Decision      | `proposed`, `approved`, `applied` or `rejected`, with the date and the reason for the last two.                                                             |

To add an item, add a row with the measured columns set to `not measured`. To judge it, apply it on a branch, run the bench on the target devices before and after, run the parity gate, fill in both columns, and ask the owner. Only an `approved` item is applied.

### Candidates

Every item is `proposed`. None is applied.

| Item                                                                                                                                                        | Expected gain                                                                                                                                 | Measured gain | Parity diff  | Decision |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------ | -------- |
| Fewer particles per tier: lower the `rain`, `snow` and `dust` counts in `TIERS` (`src/core/tables.ts`)                                                      | Less vertex and fill work in the particle pass, where the counts are 2500 to 8000 rain, 700 to 3200 snow and 250 to 600 dust across the tiers | not measured  | not measured | proposed |
| Fewer ray taps: lower `rayTaps` in `TIERS`, which bounds the loop in `rays.frag.glsl`                                                                       | Fewer texture reads per pixel in the rays pass (6, 10 and 16 taps across the tiers)                                                           | not measured  | not measured | proposed |
| RGBA8 instead of half-float for the HDR targets (the fallback path that exists today for devices without `EXT_color_buffer_float`, applied to every device) | Half the memory and bandwidth for the sky and scene targets                                                                                   | not measured  | not measured | proposed |
| Skip the per-frame mipmap build of the scene target (`generateMipmaps` in `src/passes/pipeline.ts`)                                                         | One mipmap generation per frame saved; the rays pass reads the scene's lower levels, so its output would change                               | not measured  | not measured | proposed |
| Lower octave caps: reduce `oct` in `TIERS`, the octave count of the cloud noise in `sky.frag.glsl`                                                          | Fewer noise evaluations per sky pixel (4, 5 and 6 octaves across the tiers)                                                                   | not measured  | not measured | proposed |
| Shader identifier minification beyond whitespace and comments in `scripts/shaders.ts`                                                                       | Smaller shader text in the bundle, and less to parse at startup                                                                               | not measured  | not measured | proposed |

The generator keeps v6's identifiers and numbers on purpose, so even a rename is held to the same rule as the other items.

## Recorded decisions

### Core bundle size: above v6's

**Status:** recorded for the owner's review. The size check holds the core at the size it had when this was measured.

The budget asked that `skye` (the core entry: `createSky`, params, types) stay within v6's minified, brotli-compressed size. It does not. All figures are minified, then compressed with brotli at quality 11.

The first two columns are **bundled by your bundler**: the entry and everything it imports in one minified file, as an app's build produces it. The last is **loaded from a CDN as published**: the minified files of `dist/` as they are, each compressed on its own and summed over the chain of files the entry imports. jsDelivr's `/+esm` endpoint serves an entry bundled into one file instead, which brings a CDN page close to the bundled figures; it is not measured here.

|                                  | Bundled: esbuild 0.28.2 (the method of the original baseline) | Bundled: size-limit 14.1.0 (rolldown) | From a CDN as published (`dist/`) |
| -------------------------------- | ------------------------------------------------------------- | ------------------------------------- | --------------------------------- |
| v6, the whole element            | 14136 B                                                       | 14048 B                               | —                                 |
| `skye` (core only)               | 17227 B (+3091 B, +21.9%)                                     | 17079 B                               | 17561 B in 3 files                |
| `skye/define` (element and core) | 20218 B                                                       | 20075 B                               | 21391 B in 5 files                |
| `skye/react` (React external)    | 20815 B                                                       | 20630 B                               | 22120 B in 5 files                |

Before `dist/` was minified, a CDN page loading `dist/define.js` fetched 117 kB (32.4 kB brotli); minified it is 65.7 kB (21.4 kB brotli). Minifying leaves the shader strings as they are, and the parity smoke test in `test/consumers/parity.test.ts` renders the published build beside v6 to show the pixels did not change.

**Where the bytes are** (esbuild, minified / brotli):

| Part        | v6             | skye core       |
| ----------- | -------------- | --------------- |
| Shader text | 20652 / 6236 B | 18046 / 5780 B  |
| JavaScript  | 22170 / 7941 B | 35946 / 11423 B |

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

# Pixel parity with v6

skye must draw exactly what v6 draws. v6 is the renderer skye was ported from, and its source is kept unchanged in `test/reference/weather-sky-v6.js`. The parity gate checks this on every test run, in WebKit, Chromium and Firefox.

## What the gate compares

Each case puts v6 and skye side by side in the same page. They have the same CSS size, the same device pixel ratio and the same parameters. Both draw a frame for the same animation time, and both canvases are read back with `readPixels` right after drawing. The two images are compared channel by channel.

No reference images are stored. Both renderers run on the same GPU, driver and browser at the same moment, so a result never depends on the machine it was recorded on.

The matrix covers:

- **Static frames** (`static.browser.test.ts`): every scene at night, dawn, noon and dusk, in a landscape box and in a portrait box with odd sizes.
- **Static frames in a worker** (`worker.browser.test.ts`): the same matrix, with skye's core drawing in a dedicated worker on a canvas transferred to an `OffscreenCanvas`. The worker reads the pixels back right after each frame and posts them to the page. An engine whose workers get no WebGL2 for an `OffscreenCanvas` skips these cases and names that reason.
- **The published build** (`test/consumers/parity.test.ts`, run by `bun run test:consumers`): the packed, minified `@a240/skye/define` element draws one static scene beside v6 in each engine, read back in the frame it draws. It shows that minifying `dist/` changed no pixel. Both sides get no wind, since each frame moves the clouds by the wind and the two draw different numbers of frames there.
- **Animation** (`animated.browser.test.ts`):
  - 30 frames at 60 fps for rainy, snowy, fog, sleet and haze;
  - storm, run through lightning strikes until a bolt is visible;
  - a scene change in the middle of a sequence;
  - repeated and backward frame times;
  - a resize, then a change of pixel ratio, during a 30 fps sequence.
- **Blur** (`blur.browser.test.ts`): a fade from 0 to 12 px and back at pixel ratios 1 and 2, with frames through both tweens and the settled, shrunk canvas in between. Also a deep static blur at the low tier.
- **Settings** (`quality.browser.test.ts`):
  - each quality tier;
  - the glass layer off;
  - focus and exposure at and beyond their limits;
  - explicit wind speeds;
  - pixel ratios 1.25, 2 and 3 against the balanced and high tiers' caps;
  - the fallback for devices without half-float render targets.

## How both sides are driven

The harness in `test/parity/harness.ts` drives every frame itself, so neither side draws on its own:

- **v6** has its animation loop replaced by a no-op before it starts. Each frame calls its `renderFrame(dt)`, with its clock replaced by the case's animation time. `dt` is computed the way v6's loop computes it: 1/60 s for the first frame after a change, then the interval since the last frame, capped at 0.1 s.
- **skye** gets `render(t)` with the same time.

The rest of each side's input is matched as follows:

- **Parameters.** v6 reads its parameters from attributes, and the harness writes every one of them, including those v6 would otherwise take from the wall clock (day of the year and moon phase). A number the case gives is written exactly as given, so v6's own parsing and clamping meet skye's.
- **Size.** v6 learns its size from a resize observer. The harness sets the size that observer would record, so a frame never depends on when the observer fires.
- **Pixel ratio.** v6 reads the device pixel ratio from the window on every frame, so the harness overrides it only while v6 draws and then puts it back. skye receives the ratio through `resize`.
- **Random numbers.** Lightning draws random numbers, and the order of the draws matters. v6 uses `Math.random`, so the harness swaps it for a seeded generator while v6 draws. skye is given its own copy of the same generator, so both sides see the same sequence.
- **Half-float targets.** To test the fallback, the harness hides the half-float render target extension from every WebGL context while both renderers start up, then restores it.

## Tolerance

A case passes when at least 99.9 % of channels are within 1/255 of v6 and no channel differs by more than 4/255.

Both renderers run the same shader text on the same driver, so the expected result is bit-identical output, and today every case is bit-identical. The tolerance leaves room for one thing only. A value computed on the CPU in a different but equivalent order can round to a neighbouring float32, which can move a channel that sits on a rounding boundary by one step.

Real mistakes move many channels by many steps and fail by a wide margin: a wrong uniform, a missed pass, a different frame interval, a buffer size off by one, or a different random draw. As a check, shifting skye's hour from 13 to 13.05 leaves only about 96 % of channels within 1/255.

## Adding a case

1. Choose the file that matches what you are testing: static, animated, blur or settings. The static matrix itself lives in `cases.ts`, which both the main-thread and the worker run read.
2. Create a pair with `ParityPair.create(params, cssWidth, cssHeight, options)`. The options set the device pixel ratio or turn off half-float targets. Dispose of the pair when the case ends.
3. Change parameters with `pair.update` and the size or pixel ratio with `pair.resize`. These behave like `Sky.update` and `Sky.resize`.
4. Call `pair.frame(t)` for each frame and pass the result to `expectParity`. Give each frame a label, so a failure names the frame and the worst pixel.
5. Add only cases that reach a code path no existing case reaches. Each case adds time to every run in three browsers.

If a case needs a behaviour of v6 that the harness cannot reach yet, extend the harness. Never edit the reference file.

## When a case fails

Fix the divergence in skye. Never fix it by editing the reference, and never by loosening the tolerance. v6's behaviour, including its quirks, is the specification.

If a difference seems impossible to remove, treat that as a design question. Record the evidence first: the case, the frame, the worst pixel, and the cause traced through both renderers.

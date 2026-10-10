import { blurKernel, createBlurKernel } from "../core/blur-kernel.ts";
import type { Gpu } from "../gl/context.ts";
import type { Program, Values } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

// Weights of a plain bilinear copy: the centre tap alone. A vec4, like the blur kernel's, so it fills uW and no more.
const COPY_WEIGHTS: readonly [number, number, number, number] = [1, 0, 0, 0];

/**
 * Passes 5 and 6: the separable Gaussian over the glass output, ping-ponging
 * between two targets and drawing only into their used sub-rect.
 */
export class BlurPass {
  readonly program: Program<"BLUR">;
  readonly #v: Values<"BLUR">;
  readonly #kernel = createBlurKernel();

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.FULLSCREEN_VS, glsl.BLUR_FS, glsl.BLUR_UNIFORMS);
    this.#v = this.program.values;
  }

  /** `a` holds the glass output; `b` is scratch. The result lands on the canvas. */
  draw(gpu: Gpu, f: PassFrame, a: Target, b: Target): void {
    const l = f.layout;
    const v = this.#v;
    const bw = l.blurWidth;
    const bh = l.blurHeight;
    let src = a;
    let dst = b;
    let sw = l.shrink ? bw : l.canvasWidth;
    let sh = l.shrink ? bh : l.canvasHeight;
    this.program.use();
    // Pre-filter: halve the full-size glass down to the chain size in steps of at most 2x, so bilinear taps never alias.
    if (sw > bw) {
      v.fill(0, glsl.BLUR_uDir, glsl.BLUR_uDir + 2);
      v.set(COPY_WEIGHTS, glsl.BLUR_uW);
      v.fill(0, glsl.BLUR_uO, glsl.BLUR_uO + 3);
      while (sw > bw) {
        const last = bw / sw >= 0.5;
        const dw = last ? bw : Math.round(sw * 0.5);
        const dh = last ? bh : Math.round(sh * 0.5);
        gpu.bindOutput(dst, dw, dh);
        gpu.bindTexture(0, src);
        v[glsl.BLUR_uSub] = sw / src.width;
        v[glsl.BLUR_uSub + 1] = sh / src.height;
        v[glsl.BLUR_uTexel] = 1 / src.width;
        v[glsl.BLUR_uTexel + 1] = 1 / src.height;
        gpu.drawFullscreen(this.program);
        const t = src;
        src = dst;
        dst = t;
        sw = dw;
        sh = dh;
        f.pixels += dw * dh;
        f.passes++;
      }
    }
    const k = blurKernel(l.sigma, this.#kernel);
    const tx = 1 / src.width;
    const ty = 1 / src.height;
    v[glsl.BLUR_uSub] = bw / src.width;
    v[glsl.BLUR_uSub + 1] = bh / src.height;
    v[glsl.BLUR_uTexel] = tx;
    v[glsl.BLUR_uTexel + 1] = ty;
    v.set(k.weights, glsl.BLUR_uW);
    v.set(k.offsets, glsl.BLUR_uO);
    for (let it = 0; it < k.iterations; it++) {
      gpu.bindOutput(dst, bw, bh);
      gpu.bindTexture(0, src);
      v[glsl.BLUR_uDir] = tx;
      v[glsl.BLUR_uDir + 1] = 0;
      gpu.drawFullscreen(this.program);
      gpu.bindOutput(it === k.iterations - 1 && l.shrink ? null : src, bw, bh);
      gpu.bindTexture(0, dst);
      v[glsl.BLUR_uDir] = 0;
      v[glsl.BLUR_uDir + 1] = ty;
      gpu.drawFullscreen(this.program);
    }
    f.pixels += 2 * k.iterations * bw * bh;
    f.passes += 2 * k.iterations;
    if (!l.shrink) {
      // Mid-fade: bilinear blit of the small blurred result onto the full-size canvas.
      gpu.bindOutput(null, l.canvasWidth, l.canvasHeight);
      gpu.bindTexture(0, src);
      v.fill(0, glsl.BLUR_uDir, glsl.BLUR_uDir + 2);
      v.set(COPY_WEIGHTS, glsl.BLUR_uW);
      gpu.drawFullscreen(this.program);
      f.pixels += l.canvasWidth * l.canvasHeight;
      f.passes++;
    }
  }
}

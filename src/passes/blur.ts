import { blurKernel, createBlurKernel } from "../core/blur-kernel.ts";
import type { Gpu } from "../gl/context.ts";
import type { Program } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

function declareUniforms(p: Program) {
  return {
    uDir: p.vec2(glsl.BLUR_uDir),
    uSub: p.vec2(glsl.BLUR_uSub),
    uTexel: p.vec2(glsl.BLUR_uTexel),
    uW: p.vec4(glsl.BLUR_uW),
    uO: p.vec3(glsl.BLUR_uO),
  };
}

// Weights of a plain bilinear copy: the centre tap alone.
const COPY_WEIGHTS: readonly number[] = [1, 0, 0, 0];

/**
 * Passes 5 and 6: the separable Gaussian over the glass output, ping-ponging
 * between two targets and drawing only into their used sub-rect.
 */
export class BlurPass {
  readonly program: Program;
  readonly #u: ReturnType<typeof declareUniforms>;
  readonly #kernel = createBlurKernel();

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.FULLSCREEN_VS, glsl.BLUR_FS);
    this.#u = declareUniforms(this.program);
  }

  /** `a` holds the glass output; `b` is scratch. The result lands on the canvas. */
  draw(gpu: Gpu, f: PassFrame, a: Target, b: Target): void {
    const l = f.layout;
    const u = this.#u;
    const dir = u.uDir.value;
    const sub = u.uSub.value;
    const texel = u.uTexel.value;
    const bw = l.blurWidth;
    const bh = l.blurHeight;
    let src = a;
    let dst = b;
    let sw = l.shrink ? bw : l.canvasWidth;
    let sh = l.shrink ? bh : l.canvasHeight;
    this.program.use();
    // Pre-filter: halve the full-size glass down to the chain size in steps of at most 2x, so bilinear taps never alias.
    if (sw > bw) {
      dir.fill(0);
      u.uW.value.set(COPY_WEIGHTS);
      u.uO.value.fill(0);
      while (sw > bw) {
        const last = bw / sw >= 0.5;
        const dw = last ? bw : Math.round(sw * 0.5);
        const dh = last ? bh : Math.round(sh * 0.5);
        gpu.bindOutput(dst, dw, dh);
        gpu.bindTexture(0, src);
        sub[0] = sw / src.width;
        sub[1] = sh / src.height;
        texel[0] = 1 / src.width;
        texel[1] = 1 / src.height;
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
    sub[0] = bw / src.width;
    sub[1] = bh / src.height;
    texel[0] = tx;
    texel[1] = ty;
    u.uW.value.set(k.weights);
    u.uO.value.set(k.offsets);
    for (let it = 0; it < k.iterations; it++) {
      gpu.bindOutput(dst, bw, bh);
      gpu.bindTexture(0, src);
      dir[0] = tx;
      dir[1] = 0;
      gpu.drawFullscreen(this.program);
      gpu.bindOutput(it === k.iterations - 1 && l.shrink ? null : src, bw, bh);
      gpu.bindTexture(0, dst);
      dir[0] = 0;
      dir[1] = ty;
      gpu.drawFullscreen(this.program);
    }
    f.pixels += 2 * k.iterations * bw * bh;
    f.passes += 2 * k.iterations;
    if (!l.shrink) {
      // Mid-fade: bilinear blit of the small blurred result onto the full-size canvas.
      gpu.bindOutput(null, l.canvasWidth, l.canvasHeight);
      gpu.bindTexture(0, src);
      dir.fill(0);
      u.uW.value.set(COPY_WEIGHTS);
      gpu.drawFullscreen(this.program);
      f.pixels += l.canvasWidth * l.canvasHeight;
      f.passes++;
    }
  }
}

import { blurKernel, createBlurKernel } from "../core/blur-kernel.ts";
import type { Gpu } from "../gl/context.ts";
import type { Program } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import { BLUR_FS, FULLSCREEN_VS } from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

function declareUniforms(p: Program) {
  return {
    uTex: p.uniform("uTex"),
    uDir: p.uniform("uDir"),
    uSub: p.uniform("uSub"),
    uTexel: p.uniform("uTexel"),
    uW: p.uniform("uW"),
    uO: p.uniform("uO"),
  };
}

/**
 * Passes 5 and 6: the separable Gaussian over the glass output, ping-ponging
 * between two canvas-sized targets and drawing only into their used sub-rect.
 */
export class BlurPass {
  readonly program: Program;
  private readonly u: ReturnType<typeof declareUniforms>;
  private readonly kernel = createBlurKernel();

  constructor(gpu: Gpu) {
    this.program = gpu.program(FULLSCREEN_VS, BLUR_FS);
    this.u = declareUniforms(this.program);
  }

  /** `a` holds the glass output; `b` is scratch. The result lands on the canvas. */
  draw(gpu: Gpu, f: PassFrame, a: Target, b: Target): void {
    const l = f.layout;
    const u = this.u;
    const bw = l.blurWidth;
    const bh = l.blurHeight;
    let src = a;
    let dst = b;
    let sw = l.shrink ? bw : l.canvasWidth;
    let sh = l.shrink ? bh : l.canvasHeight;
    this.program.use();
    u.uTex.int(0);
    // Pre-filter: halve the full-size glass down to the chain size in steps of at most 2x, so bilinear taps never alias.
    if (sw > bw) {
      u.uDir.vec2(0, 0);
      u.uW.vec4(1, 0, 0, 0);
      u.uO.vec3(0, 0, 0);
      while (sw > bw) {
        const last = bw / sw >= 0.5;
        const dw = last ? bw : Math.round(sw * 0.5);
        const dh = last ? bh : Math.round(sh * 0.5);
        gpu.bindOutput(dst, dw, dh);
        gpu.bindTexture(0, src);
        u.uSub.vec2(sw / src.width, sh / src.height);
        u.uTexel.vec2(1 / src.width, 1 / src.height);
        gpu.drawFullscreen();
        const t = src;
        src = dst;
        dst = t;
        sw = dw;
        sh = dh;
        f.pixels += dw * dh;
        f.passes++;
      }
    }
    const k = blurKernel(l.sigma, this.kernel);
    const tx = 1 / src.width;
    const ty = 1 / src.height;
    u.uSub.vec2(bw / src.width, bh / src.height);
    u.uTexel.vec2(tx, ty);
    u.uW.vec4(k.weights[0], k.weights[1], k.weights[2], k.weights[3]);
    u.uO.vec3(k.offsets[0], k.offsets[1], k.offsets[2]);
    for (let it = 0; it < k.iterations; it++) {
      gpu.bindOutput(dst, bw, bh);
      gpu.bindTexture(0, src);
      u.uDir.vec2(tx, 0);
      gpu.drawFullscreen();
      gpu.bindOutput(it === k.iterations - 1 && l.shrink ? null : src, bw, bh);
      gpu.bindTexture(0, dst);
      u.uDir.vec2(0, ty);
      gpu.drawFullscreen();
    }
    f.pixels += 2 * k.iterations * bw * bh;
    f.passes += 2 * k.iterations;
    if (!l.shrink) {
      // Mid-fade: bilinear blit of the small blurred result onto the full-size canvas.
      gpu.bindOutput(null, l.canvasWidth, l.canvasHeight);
      gpu.bindTexture(0, src);
      u.uDir.vec2(0, 0);
      u.uW.vec4(1, 0, 0, 0);
      gpu.drawFullscreen();
      f.pixels += l.canvasWidth * l.canvasHeight;
      f.passes++;
    }
  }
}

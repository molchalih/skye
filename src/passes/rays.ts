import type { Gpu } from "../gl/context.ts";
import type { Program, Values } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

/** Whether the ray pass runs this frame; the glass pass reads its texture only then. */
export function raysActive(f: PassFrame): boolean {
  return f.state.rays > 0.001 && f.state.sun.visibility > 0.001;
}

/** The rays: crepuscular rays gathered toward the sun at sky resolution, from the scene buffer's mips. */
export class RaysPass {
  readonly program: Program<"RAYS">;
  readonly #v: Values<"RAYS">;

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.FULLSCREEN_VS, glsl.RAYS_FS, glsl.RAYS_UNIFORMS);
    this.#v = this.program.values;
  }

  draw(gpu: Gpu, f: PassFrame, scene: Target, out: Target): void {
    const { layout: l, tier: q } = f;
    const v = this.#v;
    this.program.use();
    gpu.bindOutput(out, l.skyWidth, l.skyHeight);
    gpu.bindTexture(0, scene);
    v.set(f.sunUV, glsl.RAYS_uSunUV);
    v[glsl.RAYS_uRes] = l.skyWidth;
    v[glsl.RAYS_uRes + 1] = l.skyHeight;
    v[glsl.RAYS_uEnc] = f.encoding;
    // Rays gather from the scene's mip chain, two levels coarser than the sky buffer's own size.
    v[glsl.RAYS_uLod] = 2 + Math.log2(l.sceneHeight / l.skyHeight);
    v[glsl.RAYS_uTaps] = q.rayTaps;
    gpu.drawFullscreen(this.program);
    // A tap costs about a quarter of a shaded pixel.
    f.pixels += l.skyWidth * l.skyHeight * q.rayTaps * 0.25;
    f.passes++;
  }
}

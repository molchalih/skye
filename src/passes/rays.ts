import type { Gpu } from "../gl/context.ts";
import type { Program } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

function declareUniforms(p: Program) {
  return {
    uSunUV: p.vec2(glsl.RAYS_uSunUV),
    uRes: p.vec2(glsl.RAYS_uRes),
    uEnc: p.float(glsl.RAYS_uEnc),
    uLod: p.float(glsl.RAYS_uLod),
    uTaps: p.int(glsl.RAYS_uTaps),
  };
}

/** Whether the ray pass runs this frame; the glass pass reads its texture only then. */
export function raysActive(f: PassFrame): boolean {
  return f.state.rays > 0.001 && f.state.sunUp > 0.001;
}

/** Pass 3: crepuscular rays gathered toward the sun at sky resolution, from the scene buffer's mips. */
export class RaysPass {
  readonly program: Program;
  readonly #u: ReturnType<typeof declareUniforms>;

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.FULLSCREEN_VS, glsl.RAYS_FS);
    this.#u = declareUniforms(this.program);
  }

  draw(gpu: Gpu, f: PassFrame, scene: Target, out: Target): void {
    const { state: s, layout: l, tier: q } = f;
    const u = this.#u;
    this.program.use();
    gpu.bindOutput(out, l.skyWidth, l.skyHeight);
    gpu.bindTexture(0, scene);
    u.uSunUV.value.set(s.sunUV);
    u.uRes.value[0] = l.skyWidth;
    u.uRes.value[1] = l.skyHeight;
    u.uEnc.value = f.enc;
    u.uLod.value = 2 + Math.log2(l.sceneHeight / l.skyHeight);
    u.uTaps.value = q.rayTaps;
    gpu.drawFullscreen(this.program);
    f.pixels += l.skyWidth * l.skyHeight * q.rayTaps * 0.25;
    f.passes++;
  }
}

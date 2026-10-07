import type { Gpu } from "../gl/context.ts";
import type { Program } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import { FULLSCREEN_VS, RAYS_FS } from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

function declareUniforms(p: Program) {
  return {
    uScene: p.uniform("uScene"),
    uSunUV: p.uniform("uSunUV"),
    uRes: p.uniform("uRes"),
    uEnc: p.uniform("uEnc"),
    uLod: p.uniform("uLod"),
    uTaps: p.uniform("uTaps"),
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
    this.program = gpu.program(FULLSCREEN_VS, RAYS_FS);
    this.#u = declareUniforms(this.program);
  }

  draw(gpu: Gpu, f: PassFrame, scene: Target, out: Target): void {
    const { state: s, layout: l, tier: q } = f;
    const u = this.#u;
    this.program.use();
    gpu.bindOutput(out, l.skyWidth, l.skyHeight);
    gpu.bindTexture(0, scene);
    u.uScene.int(0);
    u.uSunUV.vec2(s.sunUV[0], s.sunUV[1]);
    u.uRes.vec2(l.skyWidth, l.skyHeight);
    u.uEnc.float(f.enc);
    u.uLod.float(2 + Math.log2(l.sceneHeight / l.skyHeight));
    u.uTaps.int(q.rayTaps);
    gpu.drawFullscreen();
    f.pixels += l.skyWidth * l.skyHeight * q.rayTaps * 0.25;
    f.passes++;
  }
}

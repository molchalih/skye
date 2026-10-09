import type { Gpu } from "../gl/context.ts";
import type { Program } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

function declareUniforms(p: Program) {
  return {
    uRes: p.vec2(glsl.COMPOSITE_uRes),
    uSunPos: p.vec2(glsl.COMPOSITE_uSunPos),
    uMoonPos: p.vec2(glsl.COMPOSITE_uMoonPos),
    uBoltPos: p.vec2(glsl.COMPOSITE_uBoltPos),
    uTime: p.float(glsl.COMPOSITE_uTime),
    uSeed: p.float(glsl.COMPOSITE_uSeed),
    uSunUp: p.float(glsl.COMPOSITE_uSunUp),
    uMoonUp: p.float(glsl.COMPOSITE_uMoonUp),
    uMoonPhase: p.float(glsl.COMPOSITE_uMoonPhase),
    uStar: p.float(glsl.COMPOSITE_uStar),
    uEnc: p.float(glsl.COMPOSITE_uEnc),
    uHide: p.float(glsl.COMPOSITE_uHide),
    uBolt: p.float(glsl.COMPOSITE_uBolt),
    uBoltSeed: p.float(glsl.COMPOSITE_uBoltSeed),
    uSunCol: p.vec3(glsl.COMPOSITE_uSunCol),
    uMoonCol: p.vec3(glsl.COMPOSITE_uMoonCol),
  };
}

/** Pass 2: upsamples the sky buffer and adds moon, stars, meteors, sun disc and bolt core at scene resolution. */
export class CompositePass {
  readonly program: Program;
  readonly #u: ReturnType<typeof declareUniforms>;

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.FULLSCREEN_VS, glsl.COMPOSITE_FS);
    this.#u = declareUniforms(this.program);
  }

  draw(gpu: Gpu, f: PassFrame, sky: Target, out: Target): void {
    const { state: s, layout: l, bolt: b } = f;
    const u = this.#u;
    this.program.use();
    gpu.bindOutput(out, l.sceneWidth, l.sceneHeight);
    gpu.bindTexture(0, sky);
    u.uRes.value[0] = l.sceneWidth;
    u.uRes.value[1] = l.sceneHeight;
    u.uSunPos.value.set(s.sunPos);
    u.uMoonPos.value.set(s.moonPos);
    u.uBoltPos.value.set(b.position);
    u.uTime.value = f.time;
    u.uSeed.value = s.seed;
    u.uSunUp.value = s.sunUp;
    u.uMoonUp.value = s.moonUp;
    u.uMoonPhase.value = s.moonPhase;
    u.uStar.value = s.star;
    u.uEnc.value = f.enc;
    u.uHide.value = s.hide;
    u.uBolt.value = b.bolt;
    u.uBoltSeed.value = b.seed;
    u.uSunCol.value.set(s.sunColor);
    u.uMoonCol.value.set(s.moonColor);
    gpu.drawFullscreen(this.program);
    f.pixels += l.sceneWidth * l.sceneHeight;
    f.passes++;
  }
}

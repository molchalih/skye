import { mix } from "../core/math.ts";
import type { Gpu } from "../gl/context.ts";
import type { Program } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

function declareUniforms(p: Program) {
  return {
    uMode: p.float(glsl.PARTICLES_uMode),
    uTime: p.float(glsl.PARTICLES_uTime),
    uWindT: p.float(glsl.PARTICLES_uWindT),
    uWindNow: p.float(glsl.PARTICLES_uWindNow),
    uAsp: p.float(glsl.PARTICLES_uAsp),
    uFocus: p.float(glsl.PARTICLES_uFocus),
    uSeed: p.float(glsl.PARTICLES_uSeed),
    uSize: p.float(glsl.PARTICLES_uSize),
    uInt: p.float(glsl.PARTICLES_uInt),
    uFlash: p.float(glsl.PARTICLES_uFlash),
    uEnc: p.float(glsl.PARTICLES_uEnc),
    uSleet: p.float(glsl.PARTICLES_uSleet),
    uHorizon: p.vec3(glsl.PARTICLES_uHorizon),
    uZenith: p.vec3(glsl.PARTICLES_uZenith),
    uLCol: p.vec3(glsl.PARTICLES_uLCol),
    uLPos: p.vec2(glsl.PARTICLES_uLPos),
  };
}

const RAIN = 0;
const SNOW = 1;
const DUST = 2;

/** Pass 2b: rain streaks, snow flakes and dust motes as instanced quads blended over the scene buffer. */
export class ParticlesPass {
  readonly program: Program;
  readonly #u: ReturnType<typeof declareUniforms>;

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.PARTICLES_VS, glsl.PARTICLES_FS);
    this.#u = declareUniforms(this.program);
  }

  draw(gpu: Gpu, f: PassFrame, out: Target): void {
    const { state: s, layout: l, tier: q } = f;
    // Same operand order as v6 so the rounded counts match exactly.
    const precip = mix(0.08, 1, Math.pow(s.intensity, 1.3));
    const rain = s.rain > 0.02 ? Math.round(q.rain * l.particleScale * s.rain * precip) : -1;
    const snow = s.snow > 0.02 ? Math.round(q.snow * l.particleScale * s.snow * precip) : -1;
    const dust = s.dust > 0.02 ? Math.round(q.dust * l.particleScale * s.dust) : -1;
    if (rain < 0 && snow < 0 && dust < 0) return;
    const u = this.#u;
    this.program.use();
    gpu.bindOutput(out, l.sceneWidth, l.sceneHeight);
    gpu.blend(true);
    u.uTime.value = f.time;
    u.uWindT.value = f.windT;
    u.uWindNow.value = f.windNow;
    u.uAsp.value = s.aspect;
    u.uFocus.value = s.focus;
    u.uSeed.value = s.seed;
    u.uSize.value = 1;
    u.uInt.value = s.intensity;
    u.uFlash.value = f.flash;
    u.uEnc.value = f.enc;
    u.uSleet.value = s.sleet;
    u.uHorizon.value.set(s.horizon);
    u.uZenith.value.set(s.zenith);
    u.uLCol.value.set(s.lightColor);
    u.uLPos.value.set(s.lightPos);
    if (rain >= 0) this.#drawMode(gpu, RAIN, rain);
    if (snow >= 0) this.#drawMode(gpu, SNOW, snow);
    if (dust >= 0) this.#drawMode(gpu, DUST, dust);
    gpu.blend(false);
    f.passes++;
  }

  #drawMode(gpu: Gpu, mode: number, count: number): void {
    this.#u.uMode.value = mode;
    gpu.drawQuads(this.program, Math.max(1, count));
  }
}

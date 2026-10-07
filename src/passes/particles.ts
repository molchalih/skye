import { mix } from "../core/math.ts";
import type { Gpu } from "../gl/context.ts";
import type { Program } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import { PARTICLES_FS, PARTICLES_VS } from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

function declareUniforms(p: Program) {
  return {
    uMode: p.uniform("uMode"),
    uTime: p.uniform("uTime"),
    uWindT: p.uniform("uWindT"),
    uWindNow: p.uniform("uWindNow"),
    uAsp: p.uniform("uAsp"),
    uFocus: p.uniform("uFocus"),
    uSeed: p.uniform("uSeed"),
    uSize: p.uniform("uSize"),
    uInt: p.uniform("uInt"),
    uFlash: p.uniform("uFlash"),
    uEnc: p.uniform("uEnc"),
    uSleet: p.uniform("uSleet"),
    uHorizon: p.uniform("uHorizon"),
    uZenith: p.uniform("uZenith"),
    uLCol: p.uniform("uLCol"),
    uLPos: p.uniform("uLPos"),
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
    this.program = gpu.program(PARTICLES_VS, PARTICLES_FS);
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
    u.uTime.float(f.time);
    u.uWindT.float(f.windT);
    u.uWindNow.float(f.windNow);
    u.uAsp.float(s.aspect);
    u.uFocus.float(s.focus);
    u.uSeed.float(s.seed);
    u.uSize.float(1);
    u.uInt.float(s.intensity);
    u.uFlash.float(f.flash);
    u.uEnc.float(f.enc);
    u.uSleet.float(s.sleet);
    u.uHorizon.vec3(s.horizon[0], s.horizon[1], s.horizon[2]);
    u.uZenith.vec3(s.zenith[0], s.zenith[1], s.zenith[2]);
    u.uLCol.vec3(s.lightColor[0], s.lightColor[1], s.lightColor[2]);
    u.uLPos.vec2(s.lightPos[0], s.lightPos[1]);
    if (rain >= 0) this.#drawMode(gpu, RAIN, rain);
    if (snow >= 0) this.#drawMode(gpu, SNOW, snow);
    if (dust >= 0) this.#drawMode(gpu, DUST, dust);
    gpu.blend(false);
    f.passes++;
  }

  #drawMode(gpu: Gpu, mode: number, count: number): void {
    this.#u.uMode.float(mode);
    gpu.drawQuads(Math.max(1, count));
  }
}

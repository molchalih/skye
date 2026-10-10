import { mix } from "../core/math.ts";
import type { Gpu } from "../gl/context.ts";
import type { Program, Values } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

const RAIN = 0;
const SNOW = 1;
const DUST = 2;

/** Pass 2b: rain streaks, snow flakes and dust motes as instanced quads blended over the scene buffer. */
export class ParticlesPass {
  readonly program: Program<"PARTICLES">;
  readonly #v: Values<"PARTICLES">;

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.PARTICLES_VS, glsl.PARTICLES_FS, glsl.PARTICLES_UNIFORMS);
    this.#v = this.program.values;
  }

  draw(gpu: Gpu, f: PassFrame, out: Target): void {
    const { state: s, layout: l, tier: q } = f;
    // Same operand order as v6 so the rounded counts match exactly.
    const precip = mix(0.08, 1, Math.pow(s.intensity, 1.3));
    const rain = s.rain > 0.02 ? Math.round(q.rain * l.particleScale * s.rain * precip) : -1;
    const snow = s.snow > 0.02 ? Math.round(q.snow * l.particleScale * s.snow * precip) : -1;
    const dust = s.dust > 0.02 ? Math.round(q.dust * l.particleScale * s.dust) : -1;
    if (rain < 0 && snow < 0 && dust < 0) return;
    const v = this.#v;
    this.program.use();
    gpu.bindOutput(out, l.sceneWidth, l.sceneHeight);
    gpu.blend(true);
    v[glsl.PARTICLES_uTime] = f.time;
    v[glsl.PARTICLES_uWindT] = f.windT;
    v[glsl.PARTICLES_uWindNow] = f.windNow;
    v[glsl.PARTICLES_uAsp] = s.aspect;
    v[glsl.PARTICLES_uFocus] = s.focus;
    v[glsl.PARTICLES_uSeed] = s.seed;
    v[glsl.PARTICLES_uSize] = 1;
    v[glsl.PARTICLES_uInt] = s.intensity;
    v[glsl.PARTICLES_uFlash] = f.flash;
    v[glsl.PARTICLES_uEnc] = f.enc;
    v[glsl.PARTICLES_uSleet] = s.sleet;
    v.set(s.horizon, glsl.PARTICLES_uHorizon);
    v.set(s.zenith, glsl.PARTICLES_uZenith);
    v.set(s.lightColor, glsl.PARTICLES_uLCol);
    v.set(s.lightPos, glsl.PARTICLES_uLPos);
    if (rain >= 0) this.#drawMode(gpu, RAIN, rain);
    if (snow >= 0) this.#drawMode(gpu, SNOW, snow);
    if (dust >= 0) this.#drawMode(gpu, DUST, dust);
    gpu.blend(false);
    f.passes++;
  }

  #drawMode(gpu: Gpu, mode: number, count: number): void {
    this.#v[glsl.PARTICLES_uMode] = mode;
    gpu.drawQuads(this.program, Math.max(1, count));
  }
}

import { mix } from "../core/math.ts";
import type { Gpu } from "../gl/context.ts";
import type { Program, Values } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

// The particle shader's modes.
const RAIN = 0;
const SNOW = 1;
const DUST = 2;
/** A weather this faint draws no particles; any more draws at least one. */
const MIN_PARTICLE_AMOUNT = 0.02;

/** The particles: rain streaks, snow flakes and dust motes as instanced quads blended over the scene buffer. */
export class ParticlesPass {
  readonly program: Program<"PARTICLES">;
  readonly #v: Values<"PARTICLES">;

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.PARTICLES_VS, glsl.PARTICLES_FS, glsl.PARTICLES_UNIFORMS);
    this.#v = this.program.values;
  }

  draw(gpu: Gpu, f: PassFrame, out: Target): void {
    const { state: s, layout: l, tier: q } = f;
    // Precipitation thins out faster than linearly as it weakens, to a trickle of 8 %. The counts are worked out
    // here rather than by a helper: this runs every frame, and numbers passed to a call V8 leaves out are boxed.
    const precipitation = mix(0.08, 1, Math.pow(s.intensity, 1.3));
    const scale = l.particleScale;
    const rain =
      s.rain > MIN_PARTICLE_AMOUNT
        ? Math.max(1, Math.round(q.raindrops * scale * s.rain * precipitation))
        : 0;
    const snow =
      s.snow > MIN_PARTICLE_AMOUNT
        ? Math.max(1, Math.round(q.snowflakes * scale * s.snow * precipitation))
        : 0;
    const dust =
      s.dust > MIN_PARTICLE_AMOUNT ? Math.max(1, Math.round(q.dustMotes * scale * s.dust)) : 0;
    if (rain + snow + dust === 0) return;
    const v = this.#v;
    this.program.use();
    gpu.bindOutput(out, l.sceneWidth, l.sceneHeight);
    gpu.blend(true);
    v[glsl.PARTICLES_uTime] = f.seconds;
    v[glsl.PARTICLES_uWindT] = f.wind.offset;
    v[glsl.PARTICLES_uWindNow] = f.wind.speed;
    v[glsl.PARTICLES_uAsp] = s.aspect;
    v[glsl.PARTICLES_uFocus] = s.focus;
    v[glsl.PARTICLES_uSeed] = s.seed;
    v[glsl.PARTICLES_uSize] = 1;
    v[glsl.PARTICLES_uInt] = s.intensity;
    v[glsl.PARTICLES_uFlash] = f.lightning.flash;
    v[glsl.PARTICLES_uEnc] = f.encoding;
    v[glsl.PARTICLES_uSleet] = s.sleet;
    v.set(s.horizon, glsl.PARTICLES_uHorizon);
    v.set(s.zenith, glsl.PARTICLES_uZenith);
    v.set(s.light.color, glsl.PARTICLES_uLCol);
    v.set(s.light.position, glsl.PARTICLES_uLPos);
    if (rain > 0) this.#drawMode(gpu, RAIN, rain);
    if (snow > 0) this.#drawMode(gpu, SNOW, snow);
    if (dust > 0) this.#drawMode(gpu, DUST, dust);
    gpu.blend(false);
    f.passes++;
  }

  #drawMode(gpu: Gpu, mode: number, count: number): void {
    this.#v[glsl.PARTICLES_uMode] = mode;
    gpu.drawQuads(this.program, count);
  }
}

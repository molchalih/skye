import type { Gpu } from "../gl/context.ts";
import type { Program, Values } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

/** Pass 2: upsamples the sky buffer and adds moon, stars, meteors, sun disc and bolt core at scene resolution. */
export class CompositePass {
  readonly program: Program<"COMPOSITE">;
  readonly #v: Values<"COMPOSITE">;

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.FULLSCREEN_VS, glsl.COMPOSITE_FS, glsl.COMPOSITE_UNIFORMS);
    this.#v = this.program.values;
  }

  draw(gpu: Gpu, f: PassFrame, sky: Target, out: Target): void {
    const { state: s, layout: l, bolt: b } = f;
    const v = this.#v;
    this.program.use();
    gpu.bindOutput(out, l.sceneWidth, l.sceneHeight);
    gpu.bindTexture(0, sky);
    v[glsl.COMPOSITE_uRes] = l.sceneWidth;
    v[glsl.COMPOSITE_uRes + 1] = l.sceneHeight;
    v.set(s.sunPos, glsl.COMPOSITE_uSunPos);
    v.set(s.moonPos, glsl.COMPOSITE_uMoonPos);
    v.set(b.position, glsl.COMPOSITE_uBoltPos);
    v[glsl.COMPOSITE_uTime] = f.time;
    v[glsl.COMPOSITE_uSeed] = s.seed;
    v[glsl.COMPOSITE_uSunUp] = s.sunUp;
    v[glsl.COMPOSITE_uMoonUp] = s.moonUp;
    v[glsl.COMPOSITE_uMoonPhase] = s.moonPhase;
    v[glsl.COMPOSITE_uStar] = s.star;
    v[glsl.COMPOSITE_uEnc] = f.enc;
    v[glsl.COMPOSITE_uHide] = s.hide;
    v[glsl.COMPOSITE_uBolt] = b.bolt;
    v[glsl.COMPOSITE_uBoltSeed] = b.seed;
    v.set(s.sunColor, glsl.COMPOSITE_uSunCol);
    v.set(s.moonColor, glsl.COMPOSITE_uMoonCol);
    gpu.drawFullscreen(this.program);
    f.pixels += l.sceneWidth * l.sceneHeight;
    f.passes++;
  }
}

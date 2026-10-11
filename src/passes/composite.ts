import type { Gpu } from "../gl/context.ts";
import type { Program, Values } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

/** The composite: upsamples the sky buffer and adds moon, stars, meteors, sun disc and bolt core at scene resolution. */
export class CompositePass {
  readonly program: Program<"COMPOSITE">;
  readonly #v: Values<"COMPOSITE">;

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.FULLSCREEN_VS, glsl.COMPOSITE_FS, glsl.COMPOSITE_UNIFORMS);
    this.#v = this.program.values;
  }

  draw(gpu: Gpu, f: PassFrame, sky: Target, out: Target): void {
    const { state: s, layout: l, lightning: b } = f;
    const v = this.#v;
    this.program.use();
    gpu.bindOutput(out, l.sceneWidth, l.sceneHeight);
    gpu.bindTexture(0, sky);
    v[glsl.COMPOSITE_uRes] = l.sceneWidth;
    v[glsl.COMPOSITE_uRes + 1] = l.sceneHeight;
    v.set(s.sun.position, glsl.COMPOSITE_uSunPos);
    v.set(s.moon.position, glsl.COMPOSITE_uMoonPos);
    v.set(b.position, glsl.COMPOSITE_uBoltPos);
    v[glsl.COMPOSITE_uTime] = f.seconds;
    v[glsl.COMPOSITE_uSeed] = s.seed;
    v[glsl.COMPOSITE_uSunUp] = s.sun.visibility;
    v[glsl.COMPOSITE_uMoonUp] = s.moon.visibility;
    v[glsl.COMPOSITE_uMoonPhase] = s.moon.phase;
    v[glsl.COMPOSITE_uStar] = s.stars;
    v[glsl.COMPOSITE_uEnc] = f.encoding;
    v[glsl.COMPOSITE_uHide] = s.sunHidden;
    v[glsl.COMPOSITE_uBolt] = b.bolt;
    v[glsl.COMPOSITE_uBoltSeed] = b.seed;
    v.set(s.sun.color, glsl.COMPOSITE_uSunCol);
    v.set(s.moon.color, glsl.COMPOSITE_uMoonCol);
    gpu.drawFullscreen(this.program);
    f.pixels += l.sceneWidth * l.sceneHeight;
    f.passes++;
  }
}

import type { Layout } from "../core/layout.ts";
import type { Gpu } from "../gl/context.ts";
import type { Program } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import { BlurPass } from "./blur.ts";
import { CompositePass } from "./composite.ts";
import type { PassFrame } from "./frame.ts";
import { GlassPass } from "./glass.ts";
import { ParticlesPass } from "./particles.ts";
import { raysActive, RaysPass } from "./rays.ts";
import { SkyPass } from "./sky.ts";

/** The six passes and their render targets, run in v6's order. */
export class Pipeline {
  readonly #gpu: Gpu;
  readonly #sky: SkyPass;
  readonly #composite: CompositePass;
  readonly #particles: ParticlesPass;
  readonly #rays: RaysPass;
  readonly #glass: GlassPass;
  readonly #blur: BlurPass;
  readonly #programs: readonly Program[];
  readonly #skyTarget: Target;
  readonly #sceneTarget: Target;
  readonly #raysTarget: Target;
  readonly #blurA: Target;
  readonly #blurB: Target;

  constructor(gpu: Gpu) {
    this.#gpu = gpu;
    // All six compile before any link status is read, so a parallel-compiling driver overlaps them.
    this.#sky = new SkyPass(gpu);
    this.#composite = new CompositePass(gpu);
    this.#particles = new ParticlesPass(gpu);
    this.#rays = new RaysPass(gpu);
    this.#glass = new GlassPass(gpu);
    this.#blur = new BlurPass(gpu);
    this.#programs = [
      this.#sky.program,
      this.#composite.program,
      this.#particles.program,
      this.#rays.program,
      this.#glass.program,
      this.#blur.program,
    ];
    this.#skyTarget = gpu.target("hdr");
    this.#sceneTarget = gpu.target("hdr", true);
    this.#raysTarget = gpu.target("r8");
    this.#blurA = gpu.target("rgba8");
    this.#blurB = gpu.target("rgba8");
  }

  /** True once every program can be checked without stalling. */
  isSettled(): boolean {
    for (const p of this.#programs) if (!p.isSettled(this.#gpu.parallel)) return false;
    return true;
  }

  /** Verifies every link (throwing ShaderError on failure) and resolves uniforms. */
  finish(): void {
    for (const p of this.#programs) p.finish();
  }

  /** Sizes the targets for this frame's layout; only changed sizes reallocate. */
  allocate(l: Readonly<Layout>): void {
    this.#skyTarget.resize(l.skyWidth, l.skyHeight);
    this.#raysTarget.resize(l.skyWidth, l.skyHeight);
    this.#sceneTarget.resize(l.sceneWidth, l.sceneHeight);
    // The blur ping-pong targets stay full size so the first blurred frame never pays an allocation.
    this.#blurA.resize(l.width, l.height);
    this.#blurB.resize(l.width, l.height);
  }

  draw(f: PassFrame): void {
    const gpu = this.#gpu;
    this.#sky.draw(gpu, f, this.#skyTarget);
    this.#composite.draw(gpu, f, this.#skyTarget, this.#sceneTarget);
    this.#particles.draw(gpu, f, this.#sceneTarget);
    gpu.generateMipmaps(this.#sceneTarget);
    if (raysActive(f)) this.#rays.draw(gpu, f, this.#sceneTarget, this.#raysTarget);
    const blurring = f.layout.blurring;
    this.#glass.draw(gpu, f, this.#sceneTarget, this.#raysTarget, blurring ? this.#blurA : null);
    if (blurring) this.#blur.draw(gpu, f, this.#blurA, this.#blurB);
  }

  dispose(): void {
    // GL only flags the program in use for deletion; unbinding it lets the delete take effect now.
    this.#gpu.gl.useProgram(null);
    for (const p of this.#programs) p.dispose();
    this.#skyTarget.dispose();
    this.#sceneTarget.dispose();
    this.#raysTarget.dispose();
    this.#blurA.dispose();
    this.#blurB.dispose();
  }
}

import { vi } from "vitest";

/**
 * A stand-in for the display's frame callbacks: `requestAnimationFrame` is
 * replaced on the global scope, and requested callbacks run only when `tick`
 * advances the clock. Undo with `vi.unstubAllGlobals()`.
 */
export class Display {
  /** Timestamp the next `tick` advances from, in ms. */
  now = 5000;
  private readonly callbacks = new Map<number, FrameRequestCallback>();
  private nextId = 1;

  install(): this {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
      const id = this.nextId++;
      this.callbacks.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
      this.callbacks.delete(id);
    });
    return this;
  }

  /** Frame callbacks waiting for the next tick. */
  get pending(): number {
    return this.callbacks.size;
  }

  /** Advances the clock by `ms` and runs the callbacks requested before this call. */
  tick(ms: number = 1000 / 60): void {
    this.now += ms;
    const due = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const cb of due) cb(this.now);
  }
}

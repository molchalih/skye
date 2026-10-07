/** A listener for one event; `payload` is `undefined` for events that carry none. */
export type Listener<T> = (payload: T) => void;

// What an EventTarget does with a throwing listener: report it as uncaught and carry on with the next one.
// `reportError` reaches the scope's "error" event and the console in windows and workers alike; without it,
// a rethrow from a microtask is the closest equivalent.
function report(error: unknown): void {
  if (typeof globalThis.reportError === "function") globalThis.reportError(error);
  else
    queueMicrotask(() => {
      throw error;
    });
}

function call<T>(listener: Listener<T>, payload: T): void {
  try {
    listener(payload);
  } catch (error) {
    report(error);
  }
}

/**
 * Minimal typed event emitter. `E` maps each event name to its payload type,
 * so adding an event is one more entry in that map. A listener that throws is
 * reported as an uncaught error and does not stop the others or the emitter's
 * caller.
 */
export class Emitter<E> {
  #listeners: { [K in keyof E]?: Set<Listener<E[K]>> } = {};
  #latched: { [K in keyof E]?: { payload: E[K]; heard: boolean } } = {};

  /**
   * Adds a listener and returns the function that removes it. When `name` is
   * latched, the listener also receives the latched payload on a microtask,
   * unless it is removed first.
   */
  on<K extends keyof E>(name: K, listener: Listener<E[K]>): () => void {
    const set: Set<Listener<E[K]>> = this.#listeners[name] ?? new Set();
    this.#listeners[name] = set;
    set.add(listener);
    const latched = this.#latched[name];
    if (latched !== undefined) {
      queueMicrotask(() => {
        if (!set.has(listener)) return;
        latched.heard = true;
        call(listener, latched.payload);
      });
    }
    return () => {
      set.delete(listener);
    };
  }

  /** Calls every listener of `name` in subscription order. Returns whether there was one. */
  emit<K extends keyof E>(name: K, payload: E[K]): boolean {
    const set = this.#listeners[name];
    if (set === undefined || set.size === 0) return false;
    for (const listener of set) call(listener, payload);
    return true;
  }

  /** Emits `payload` and keeps it, so listeners added later receive it too. */
  latch<K extends keyof E>(name: K, payload: E[K]): void {
    const latched = { payload, heard: false };
    this.#latched[name] = latched;
    latched.heard = this.emit(name, payload);
  }

  /** Whether the latched payload of `name` has reached a listener, at latch time or by replay. */
  heard(name: keyof E): boolean {
    return this.#latched[name]?.heard === true;
  }

  /** Whether `name` has a listener now. */
  listening(name: keyof E): boolean {
    const set = this.#listeners[name];
    return set !== undefined && set.size > 0;
  }

  /** Drops every listener and latched payload; pending replays are cancelled. */
  clear(): void {
    for (const name in this.#listeners) this.#listeners[name]?.clear();
    this.#listeners = {};
    this.#latched = {};
  }
}

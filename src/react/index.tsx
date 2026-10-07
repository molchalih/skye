import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DetailedHTMLProps,
  type HTMLAttributes,
  type ReactElement,
  type Ref,
  type RefObject,
} from "react";
import type { SkyeStats, TierChange } from "../core/api.ts";
import type { SkyeParams } from "../core/params.ts";
// The modules themselves, not the `@a240/skye/element` entry: importing another entry makes the bundler keep a bare
// `import "./element.js"` in the output, which consumer bundlers warn about since that file is side-effect free.
import { toAttributes, type SkyeAttribute } from "../element/attributes.ts";
import { defineSkyeQuietly } from "../element/define.ts";
import {
  SKYE_CONTEXTLOST,
  SKYE_CONTEXTRESTORED,
  SKYE_ERROR,
  SKYE_FALLBACK,
  SKYE_READY,
  SKYE_TIERCHANGE,
  type SkyeElement,
} from "../element/element.ts";

type SkyeIntrinsic = DetailedHTMLProps<HTMLAttributes<SkyeElement>, SkyeElement> &
  Partial<Record<SkyeAttribute, string>>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "skye-view": SkyeIntrinsic;
    }
  }
}

/**
 * The standard HTML attributes `<Skye>` passes through to `<skye-view>`
 * (`id`, `title`, `role`, `hidden`, `tabIndex`, `aria-*`, `data-*`,
 * `className`, `style`, DOM event handlers): React's `HTMLAttributes` without
 * the names skye uses itself, and without children, which the element's
 * shadow root never shows.
 */
export type SkyeHTMLAttributes = Omit<
  HTMLAttributes<SkyeElement>,
  keyof SkyeParams | "onError" | "children" | "dangerouslySetInnerHTML"
>;

/**
 * Props of {@link Skye}: every sky param, the worker switch, event callbacks,
 * and the standard HTML attributes, which go to the element as they would on
 * any other.
 */
export interface SkyeProps extends SkyeParams, SkyeHTMLAttributes {
  /** Render in a worker. `true` uses skye's own worker; a string is the URL of the worker module to load instead. */
  worker?: boolean | string | undefined;
  /** The `<skye-view>` element. */
  ref?: Ref<SkyeElement> | undefined;
  /** Programs are linked and the sky is drawing. */
  onReady?: (() => void) | undefined;
  /** A shader did not build; the fallback gradient stays. */
  onError?: ((error: Error) => void) | undefined;
  /** The WebGL context was lost. */
  onContextLost?: (() => void) | undefined;
  /** Drawing again after a context loss. */
  onContextRestored?: (() => void) | undefined;
  /** WebGL2 is unavailable; the fallback gradient is shown for good. */
  onFallback?: (() => void) | undefined;
  /** The automatic quality tier changed. */
  onTierChange?: ((change: TierChange) => void) | undefined;
}

type Handlers = Pick<
  SkyeProps,
  "onReady" | "onError" | "onContextLost" | "onContextRestored" | "onFallback" | "onTierChange"
>;

// React writes `true` on a custom element as an empty attribute, which ARIA reads as absent: spell booleans out, as
// React does for built-in elements.
function ariaAsStrings(html: SkyeHTMLAttributes): SkyeHTMLAttributes {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(html))
    out[name] = name.startsWith("aria-") && typeof value === "boolean" ? String(value) : value;
  return out;
}

function workerAttribute(worker: boolean | string | undefined): string | undefined {
  if (worker === undefined || worker === false) return undefined;
  return worker === true ? "" : worker;
}

/**
 * `<skye-view>` as a React component. Params become the element's attributes;
 * `undefined` leaves an attribute absent and the sky on its default. The
 * element is defined on first mount and upgrades in place, so the component
 * also renders on the server as the bare tag.
 *
 * Events are bound with `addEventListener` rather than through React's
 * custom-element props, so each callback gets the typed detail and the
 * `skye-` event names are never respelled.
 */
export function Skye({
  worker,
  ref,
  onReady,
  onError,
  onContextLost,
  onContextRestored,
  onFallback,
  onTierChange,
  scene,
  cover,
  intensity,
  wind,
  seed,
  hour,
  latitude,
  dayOfYear,
  solarNoon,
  moonPhase,
  glass,
  focus,
  exposure,
  blur,
  quality,
  motion,
  ...html
}: SkyeProps): ReactElement {
  const element = useRef<SkyeElement | null>(null);
  // A new `ref` identity re-runs this with null then the element, which is harmless.
  const setRef = useCallback(
    (el: SkyeElement | null) => {
      element.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref != null) ref.current = el;
    },
    [ref],
  );

  // Listeners are bound once and read the latest callbacks, so new inline
  // functions on every render never resubscribe.
  const handlers = useRef<Handlers>({});
  useLayoutEffect(() => {
    handlers.current = {
      onReady,
      onError,
      onContextLost,
      onContextRestored,
      onFallback,
      onTierChange,
    };
  });

  useLayoutEffect(() => {
    defineSkyeQuietly();
    const el = element.current;
    if (el === null) return undefined;
    const ready = (): void => handlers.current.onReady?.();
    const error = (e: CustomEvent<Error>): void => handlers.current.onError?.(e.detail);
    const lost = (): void => handlers.current.onContextLost?.();
    const restored = (): void => handlers.current.onContextRestored?.();
    const fallback = (): void => handlers.current.onFallback?.();
    const tier = (e: CustomEvent<TierChange>): void => handlers.current.onTierChange?.(e.detail);
    el.addEventListener(SKYE_READY, ready);
    el.addEventListener(SKYE_ERROR, error);
    el.addEventListener(SKYE_CONTEXTLOST, lost);
    el.addEventListener(SKYE_CONTEXTRESTORED, restored);
    el.addEventListener(SKYE_FALLBACK, fallback);
    el.addEventListener(SKYE_TIERCHANGE, tier);
    return () => {
      el.removeEventListener(SKYE_READY, ready);
      el.removeEventListener(SKYE_ERROR, error);
      el.removeEventListener(SKYE_CONTEXTLOST, lost);
      el.removeEventListener(SKYE_CONTEXTRESTORED, restored);
      el.removeEventListener(SKYE_FALLBACK, fallback);
      el.removeEventListener(SKYE_TIERCHANGE, tier);
    };
  }, []);

  const attributes = toAttributes({
    scene,
    cover,
    intensity,
    wind,
    seed,
    hour,
    latitude,
    dayOfYear,
    solarNoon,
    moonPhase,
    glass,
    focus,
    exposure,
    blur,
    quality,
    motion,
  });
  const workerValue = workerAttribute(worker);
  if (workerValue !== undefined) attributes.worker = workerValue;
  return <skye-view {...ariaAsStrings(html)} ref={setRef} {...attributes} />;
}

function readStats(el: SkyeElement | null): SkyeStats | null {
  // Before the element upgrades, `stats` is not on the instance yet.
  return el !== null && typeof el.stats === "function" ? el.stats() : null;
}

/** The shortest polling interval, in ms; one frame at 60 Hz. */
const MIN_INTERVAL_MS = 16;

/**
 * Polls `stats()` of the referenced element every `intervalMs`, clamped to at
 * least 16 ms (a non-finite value also becomes 16). `null` until the element
 * has a renderer.
 */
export function useSkyeStats(
  ref: RefObject<SkyeElement | null>,
  intervalMs: number,
): SkyeStats | null {
  const [stats, setStats] = useState<SkyeStats | null>(null);
  useEffect(() => {
    const tick = (): void => setStats(readStats(ref.current));
    tick();
    const id = setInterval(
      tick,
      Number.isFinite(intervalMs) ? Math.max(MIN_INTERVAL_MS, intervalMs) : MIN_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [ref, intervalMs]);
  return stats;
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DetailedHTMLProps,
  type HTMLAttributes,
  type ReactElement,
  type Ref,
  type RefObject,
} from "react";
import type { SkyeStats, TierChange } from "../index.ts";
import type { SkyeParams } from "../core/params.ts";
import {
  SKYE_CONTEXTLOST,
  SKYE_CONTEXTRESTORED,
  SKYE_ERROR,
  SKYE_FALLBACK,
  SKYE_READY,
  SKYE_TIERCHANGE,
  defineSkye,
  toAttributes,
  type SkyeAttribute,
  type SkyeElement,
} from "../element/index.ts";

type SkyeIntrinsic = DetailedHTMLProps<HTMLAttributes<SkyeElement>, SkyeElement> &
  Partial<Record<SkyeAttribute, string>>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "skye-view": SkyeIntrinsic;
    }
  }
}

/** Props of {@link Skye}: every sky param, the worker switch, layout props and event callbacks. */
export interface SkyeProps extends SkyeParams {
  /** Render in a worker. `true` uses skye's own worker; a string is the URL of the worker module to load instead. */
  worker?: boolean | string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
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
  className,
  style,
  ref,
  onReady,
  onError,
  onContextLost,
  onContextRestored,
  onFallback,
  onTierChange,
  ...params
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
    defineSkye();
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

  const attributes = toAttributes(params);
  const workerValue = workerAttribute(worker);
  if (workerValue !== undefined) attributes.worker = workerValue;
  return <skye-view ref={setRef} className={className} style={style} {...attributes} />;
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

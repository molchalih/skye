import { report } from "../core/report.ts";
import { SKYE_BRAND, SKYE_BRAND_VERSION, SkyeElement } from "./element.ts";

const DEFAULT_TAG = "skye-view";

// Recognised by brand, not by class: another copy of skye may have registered the tag first. Only the same brand
// version counts; a different one is a skye this copy cannot safely share an element with.
function isSkyeElement(ctor: CustomElementConstructor): ctor is typeof SkyeElement {
  return Reflect.get(ctor, SKYE_BRAND) === SKYE_BRAND_VERSION;
}

/**
 * Registers the element under `tag` and returns its constructor. Calling it
 * again for a tag already defined returns the constructor registered there.
 * `SkyeElement` itself is registered as `skye-view`; any other tag gets its
 * own subclass, since one constructor can back only one tag.
 *
 * When the page loads skye more than once, the tag may already belong to
 * another copy's element. That counts as defined when the copy speaks the
 * same element contract (brand version): the returned constructor is the one
 * registered, which is not necessarily this copy's `SkyeElement`.
 *
 * Runs only in a browser, where `customElements` exists; on a server, import
 * `skye/define` instead, which registers the element as a side effect and
 * does nothing without a DOM. Throws when `tag` is already taken by an
 * element that is not a skye element, or by a skye of another brand version.
 */
export function defineSkye(tag: string = DEFAULT_TAG): typeof SkyeElement {
  const existing = customElements.get(tag);
  if (existing !== undefined) {
    if (isSkyeElement(existing)) return existing;
    const held: unknown = Reflect.get(existing, SKYE_BRAND);
    throw new Error(
      typeof held === "number"
        ? `skye: <${tag}> is held by skye v${held}, which this copy (v${SKYE_BRAND_VERSION}) cannot share`
        : `skye: <${tag}> is already defined by another element`,
    );
  }
  const ctor = tag === DEFAULT_TAG ? SkyeElement : class extends SkyeElement {};
  customElements.define(tag, ctor);
  return ctor;
}

/**
 * `defineSkye` for the paths nobody called on purpose (importing `skye/define`,
 * mounting `<Skye>`): a tag held by a foreign element is reported through
 * `reportError` (or its fallback) and the caller carries on, since an import or a render must
 * not be unwound by it.
 */
export function defineSkyeQuietly(tag: string = DEFAULT_TAG): void {
  try {
    defineSkye(tag);
  } catch (error) {
    report(error);
  }
}

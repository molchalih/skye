import { SkyeElement } from "./element.ts";

const DEFAULT_TAG = "skye-view";

/**
 * Registers the element under `tag` and returns its constructor. Calling it
 * again for a tag already defined returns the constructor registered there.
 * `SkyeElement` itself is registered as `skye-view`; any other tag gets its
 * own subclass, since one constructor can back only one tag.
 *
 * Runs only in a browser, where `customElements` exists; on a server, import
 * `skye/define` instead, which registers the element as a side effect and
 * does nothing without a DOM. Throws when `tag` is already taken by an
 * element that is not a `SkyeElement`.
 */
export function defineSkye(tag: string = DEFAULT_TAG): typeof SkyeElement {
  const existing = customElements.get(tag);
  if (existing !== undefined) {
    if (existing === SkyeElement || existing.prototype instanceof SkyeElement) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked just above
      return existing as typeof SkyeElement;
    }
    throw new Error(`skye: <${tag}> is already defined by another element`);
  }
  const ctor = tag === DEFAULT_TAG ? SkyeElement : class extends SkyeElement {};
  customElements.define(tag, ctor);
  return ctor;
}

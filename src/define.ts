import { defineSkyeQuietly } from "./element/define.ts";

// Type-only: brings the element's declarations, and with them `<skye-view>` in HTMLElementTagNameMap, to a program
// that imports this entry alone.
export type { SkyeElement } from "./element/element.ts";

// Without a DOM (server rendering) there is nothing to define.
if (typeof customElements !== "undefined") defineSkyeQuietly();

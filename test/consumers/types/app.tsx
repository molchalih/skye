// What a TypeScript user of the published package writes, checked against the shipped declarations only.
import { useRef, type ReactElement } from "react";
import { createSky, DEFAULTS, ShaderError, type Sky, type SkyeStats, type Tier } from "skye";
import { dayOfYear, moonPhase, solarPosition } from "skye/astro";
import "skye/define";
import {
  defineSkye,
  SKYE_ATTRIBUTES,
  SKYE_READY,
  toAttributes,
  type SkyeElement,
} from "skye/element";
import { Skye, useSkyeStats } from "skye/react";

const canvas = document.createElement("canvas");
const sky: Sky = createSky(canvas, { scene: "rainy", dayOfYear: dayOfYear(new Date(2026, 5, 21)) });
sky.update({ moonPhase: moonPhase(Date.UTC(2026, 9, 7)), hour: DEFAULTS.hour });
const elevation: number = solarPosition(52.37, 172, 13, 12.7).elevationDeg;
const failed: boolean = new Error("x") instanceof ShaderError;

// skye/element declares <skye-view> in HTMLElementTagNameMap.
const created: SkyeElement = document.createElement("skye-view");
const found: SkyeElement | null = document.querySelector("skye-view");
const stats: SkyeStats | null = created.stats();
created.addEventListener("skye-tierchange", (event) => {
  const tier: Tier = event.detail.quality;
  return tier;
});
created.addEventListener(SKYE_READY, () => undefined);
const ctor: typeof SkyeElement = defineSkye("my-sky");
const generic: CustomElementConstructor = ctor;
const attributes: readonly string[] = SKYE_ATTRIBUTES;
const scene: string | undefined = toAttributes({ scene: "fog" }).scene;

// skye/react declares <skye-view> among React's intrinsic elements, with typed attributes.
export function App(): ReactElement {
  const ref = useRef<SkyeElement>(null);
  const live: SkyeStats | null = useSkyeStats(ref, 500);
  return (
    <>
      <skye-view ref={ref} scene="storm" day-of-year="172" worker="" data-fps={live?.fps} />
      {/* @ts-expect-error attribute values are strings */}
      <skye-view scene={3} />
      <Skye scene="snowy" worker onReady={() => undefined} onTierChange={(change) => change.tier} />
    </>
  );
}

export { attributes, ctor, elevation, failed, found, generic, scene, stats };

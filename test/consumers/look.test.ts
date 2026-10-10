import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SkyeParams } from "../../src/index.ts";
import { compareToApproved, describeVerdict } from "../look/compare.ts";
import { drawnSky, ENGINES, launch, openPage, serveStatic, type StaticServer } from "./browsers.ts";
import { REPO } from "./paths.ts";

interface Frame {
  width: number;
  height: number;
  pixels: number[];
}

/** The element's attributes in index.html, as params. */
const PARAMS: SkyeParams = {
  scene: "cloudy",
  hour: 13,
  wind: 0,
  latitude: 52.37,
  dayOfYear: 172,
  solarNoon: 12.7,
  moonPhase: 0.5,
  quality: "balanced",
  motion: "static",
};

// skye draws without preserving its buffer, so the read happens in the frame that draws: an attribute change
// requests the sky's frame, and a frame callback requested after it runs once that frame is drawn.
function readSkye(page: Page): Promise<Frame> {
  return page.evaluate(
    () =>
      new Promise<Frame>((resolve, reject) => {
        const el = document.getElementById("skye");
        const gl = el?.shadowRoot?.querySelector("canvas")?.getContext("webgl2");
        if (el === null || gl === null || gl === undefined) {
          reject(new Error("no skye context"));
          return;
        }
        el.setAttribute("hour", el.getAttribute("hour") ?? "");
        requestAnimationFrame(() => {
          const width = gl.drawingBufferWidth;
          const height = gl.drawingBufferHeight;
          const pixels = new Uint8Array(width * height * 4);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          resolve({ width, height, pixels: Array.from(pixels) });
        });
      }),
  );
}

function isFrame(v: unknown): v is Frame {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof Reflect.get(v, "width") === "number" &&
    typeof Reflect.get(v, "height") === "number" &&
    Array.isArray(Reflect.get(v, "pixels"))
  );
}

// The page's drawApproved (look/index.html) draws the approved build's frame for the same params.
async function readApproved(page: Page, width: number, height: number): Promise<Frame> {
  const frame: unknown = await page.evaluate(
    async ([params, w, h]) => {
      const draw: unknown = Reflect.get(window, "drawApproved");
      if (typeof draw !== "function") throw new Error("the page has no drawApproved");
      const drawn: unknown = await Reflect.apply(draw, window, [params, w, h]);
      return drawn;
    },
    [PARAMS, width, height] as const,
  );
  if (!isFrame(frame)) throw new Error("drawApproved returned no frame");
  return frame;
}

let server: StaticServer;

beforeAll(async () => {
  server = await serveStatic(REPO);
});

afterAll(async () => {
  await server.close();
});

// The look suite runs skye's source; this runs the minified build as published, so a minifier that changed a
// number or a shader string would show here.
describe.each(ENGINES.map((engine) => [engine.name(), engine] as const))(
  "the published build beside the approved build, %s",
  (_name, engine) => {
    let browser: Browser;

    beforeAll(async () => {
      browser = await launch(engine);
    });

    afterAll(async () => {
      await browser.close();
    });

    test("<skye-view> keeps the approved look for a static scene", async () => {
      const { page, errors } = await openPage(browser);
      await page.goto(`${server.url}/test/consumers/look/index.html`);
      await drawnSky(page, "skye");
      const skye = await readSkye(page);
      const approved = await readApproved(page, 320, 120);
      expect([skye.width, skye.height]).toEqual([approved.width, approved.height]);
      const verdict = compareToApproved(
        Uint8Array.from(approved.pixels),
        Uint8Array.from(skye.pixels),
        skye.width,
        skye.height,
      );
      expect(verdict.pass, describeVerdict(verdict)).toBe(true);
      expect(errors).toEqual([]);
      expect(server.missing).toEqual([]);
      await page.close();
    });
  },
);

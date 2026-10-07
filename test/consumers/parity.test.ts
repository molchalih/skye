import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compare, describeComparison } from "../parity/compare.ts";
import { drawnSky, ENGINES, launch, openPage, serveStatic, type StaticServer } from "./browsers.ts";
import { REPO } from "./paths.ts";

interface Frame {
  width: number;
  height: number;
  pixels: number[];
}

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

// v6 keeps its buffer; once its programs are linked and its size observed, one more static frame is drawn the way
// its own loop draws one, and read back.
async function readV6(page: Page): Promise<Frame> {
  await page.waitForFunction(() => {
    const el = document.getElementById("v6");
    return (
      el !== null &&
      Boolean(Reflect.get(el, "_glass")) &&
      Boolean(Reflect.get(el, "_blur")) &&
      Number(Reflect.get(el, "_cw")) > 0
    );
  });
  return page.evaluate(() => {
    const el = document.getElementById("v6");
    const gl: unknown = el === null ? null : Reflect.get(el, "_gl");
    if (el === null || !(gl instanceof WebGL2RenderingContext)) throw new Error("no v6 context");
    Reflect.set(el, "_cur", null);
    Reflect.apply(Reflect.get(el, "renderFrame"), el, []);
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { width, height, pixels: Array.from(pixels) };
  });
}

let server: StaticServer;

beforeAll(async () => {
  server = await serveStatic(REPO);
});

afterAll(async () => {
  await server.close();
});

// The parity suite runs skye's source; this runs the minified build as published, so a minifier that changed a
// number or a shader string would show here.
describe.each(ENGINES.map((engine) => [engine.name(), engine] as const))(
  "the published build beside v6, %s",
  (_name, engine) => {
    let browser: Browser;

    beforeAll(async () => {
      browser = await launch(engine);
    });

    afterAll(async () => {
      await browser.close();
    });

    test("<skye-view> draws a static scene bit-identical to v6", async () => {
      const { page, errors } = await openPage(browser);
      await page.goto(`${server.url}/test/consumers/parity/index.html`);
      await drawnSky(page, "skye");
      const skye = await readSkye(page);
      const v6 = await readV6(page);
      expect([skye.width, skye.height]).toEqual([v6.width, v6.height]);
      const result = compare(
        Uint8Array.from(v6.pixels),
        Uint8Array.from(skye.pixels),
        v6.width,
        v6.height,
      );
      expect(result.pass, describeComparison(result)).toBe(true);
      expect(result.worst, describeComparison(result)).toBeNull();
      expect(errors).toEqual([]);
      expect(server.missing).toEqual([]);
      await page.close();
    });
  },
);

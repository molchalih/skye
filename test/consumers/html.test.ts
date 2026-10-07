import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  drawnSky,
  ENGINES,
  launch,
  MIN_COLOURS,
  openPage,
  serveStatic,
  type StaticServer,
} from "./browsers.ts";
import { CONSUMERS } from "./paths.ts";

let server: StaticServer;

beforeAll(async () => {
  server = await serveStatic(CONSUMERS);
});

afterAll(async () => {
  await server.close();
});

describe.each(ENGINES.map((engine) => [engine.name(), engine] as const))(
  "plain HTML with an import map, %s",
  (_name, engine) => {
    let browser: Browser;

    beforeAll(async () => {
      browser = await launch(engine);
    });

    afterAll(async () => {
      await browser.close();
    });

    test("dist/define.js defines <skye-view>, which draws on the main thread and in its worker", async () => {
      const { page, errors } = await openPage(browser);
      await page.goto(`${server.url}/html/index.html`);

      const main = await drawnSky(page, "main");
      expect(main.worker).toBe(false);
      expect(main.colours).toBeGreaterThan(MIN_COLOURS);

      // The unbundled dist resolves `new URL("./worker.js", import.meta.url)` from the chunk that holds it.
      const worker = await drawnSky(page, "worker");
      expect(worker.worker).toBe(true);
      expect(worker.colours).toBeGreaterThan(MIN_COLOURS);

      expect(errors).toEqual([]);
      expect(server.missing).toEqual([]);
      await page.close();
    });
  },
);

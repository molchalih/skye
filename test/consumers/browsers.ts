import { createReadStream, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from "playwright";

/** The engines of the support floor, as the browser tests run them. */
export const ENGINES: readonly BrowserType[] = [chromium, firefox, webkit];

/** How long a page may take to show a drawn sky; software GL is slow. */
const DRAW_MS = 60_000;

/** More distinct colours than this on screen means a sky, not a blank canvas over the host's flat background. */
export const MIN_COLOURS = 16;

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export interface StaticServer {
  url: string;
  /** Paths that were requested and not found. */
  missing: string[];
  close(): Promise<void>;
}

/** Serves `root` as plain files, the way a static host or CDN would: no bundler, no rewriting. */
export async function serveStatic(root: string): Promise<StaticServer> {
  const missing: string[] = [];
  const server: Server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
    const file = join(root, path);
    const type = TYPES[extname(file)];
    if (
      !file.startsWith(root) ||
      type === undefined ||
      !statSync(file, { throwIfNoEntry: false })
    ) {
      missing.push(path);
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": type });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no TCP address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    missing,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export async function launch(engine: BrowserType): Promise<Browser> {
  return engine.launch({ headless: true });
}

/** A page that records the skye events of the document and every error the page reports. */
export async function openPage(browser: Browser): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(globalThis, { skyeEvents: seen });
    for (const type of ["skye-ready", "skye-error", "skye-fallback"]) {
      document.addEventListener(type, (event) => {
        const target = event.target instanceof Element ? event.target.id : "";
        seen.push(`${type}#${target}`);
      });
    }
  });
  return { page, errors };
}

export interface Drawn {
  /** Whether the sky rendered in a worker, from the element's `stats()`. */
  worker: boolean;
  /** Distinct colours in a screenshot of the element: a blank canvas or a flat background has one. */
  colours: number;
}

/**
 * Waits until the element with `id` has revealed its canvas (it hides its gradient only in the frame the sky first
 * draws), then reads its stats and counts the colours on screen.
 */
export async function drawnSky(page: Page, id: string): Promise<Drawn> {
  const outcome = await page.waitForFunction(
    (target) => {
      const events: string[] = Reflect.get(globalThis, "skyeEvents");
      const failed = events.find(
        (event) => event.endsWith(`#${target}`) && !event.startsWith("skye-ready"),
      );
      if (failed !== undefined) return failed;
      const el = document.getElementById(target);
      const cover = el?.shadowRoot?.querySelector("div");
      if (el === null || cover?.hidden !== true) return false;
      const stats: unknown = Reflect.apply(Reflect.get(el, "stats"), el, []);
      return stats !== null ? "drawn" : false;
    },
    id,
    { timeout: DRAW_MS },
  );
  const result = await outcome.jsonValue();
  if (result !== "drawn") throw new Error(`#${id} did not draw: ${String(result)}`);
  const worker = await page.$eval(`#${id}`, (el) => {
    const stats: unknown = Reflect.apply(Reflect.get(el, "stats"), el, []);
    return typeof stats === "object" && stats !== null && Reflect.get(stats, "worker") === true;
  });
  // Right after the reveal, with no retry: the gradient goes only once the canvas shows the sky.
  const colours = await countColours(page, await page.locator(`#${id}`).screenshot());
  return { worker, colours };
}

async function countColours(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
    }
    return seen.size;
  }, png.toString("base64"));
}

// Measures the renderer per case: mount at the stage size, warm up, then sample `stats()` on every page frame.
// Main-thread mode drives the core (`createSky` on the page's own canvas) with GPU timing switched on, so every tier
// reports GPU ms. Worker mode drives `<skye-view worker>`, which times the GPU only under `quality="auto"`, and
// reports the worker's latest snapshot, taken up to four times a second. GPU ms is the renderer's own time-elapsed
// query, CPU ms its JS submission time, fps its frame counter, and drops the share of page frames longer than 1.6
// display intervals, the only way to see compositor cost. Results print as Markdown table rows.
import { createSky, type Quality, type SceneName, type SkyeStats } from "../src/index.ts";
import { toAttributes } from "../src/element/attributes.ts";
import { defineSkye } from "../src/element/define.ts";

interface Case {
  label: string;
  scene: SceneName;
  hour: number;
}

type Mode = "sharp" | "blur";

interface Row {
  scene: string;
  tier: string;
  mode: string;
  buffers: string;
  gpu: number;
  cpu: number;
  fps: number;
  drops: number;
  mpx: number;
  samples: number;
  worker: boolean;
  workerRequested: boolean;
}

const SCENES: ReadonlyArray<Case> = [
  { label: "clear 13h", scene: "clear", hour: 13 },
  { label: "cloudy 17.5h", scene: "cloudy", hour: 17.5 },
  { label: "rainy 17.5h", scene: "rainy", hour: 17.5 },
  { label: "storm 21h", scene: "storm", hour: 21 },
  { label: "snowy 9h", scene: "snowy", hour: 9 },
  { label: "fog 6.5h", scene: "fog", hour: 6.5 },
];
const TIERS: ReadonlyArray<Quality> = ["low", "balanced", "high", "auto"];
const WARM_MS = 900;
const MEASURE_MS = 1600;
const BLUR = 12;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 960;
// The worker module, served by the dev server next to the source.
const WORKER_URL = new URL("../src/worker/worker.ts", import.meta.url).href;

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) {
    throw new Error(`#${id} missing`);
  }
  return el;
}

function buttonById(id: string): HTMLButtonElement {
  const el = byId(id);
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error(`#${id} is not a button`);
  }
  return el;
}

function selectById(id: string): HTMLSelectElement {
  const el = byId(id);
  if (!(el instanceof HTMLSelectElement)) {
    throw new Error(`#${id} is not a select`);
  }
  return el;
}

function sizeParam(name: string, fallback: number): number {
  const value = Number(new URLSearchParams(location.search).get(name));
  return Number.isFinite(value) && value >= 1 ? Math.round(value) : fallback;
}

const stageWidth = sizeParam("w", DEFAULT_WIDTH);
const stageHeight = sizeParam("h", DEFAULT_HEIGHT);

const stage = byId("stage");
const runButton = buttonById("run");
const tierSelect = selectById("tiers");
const workerSelect = selectById("worker");
const setup = byId("setup");
const fill = byId("fill");
const progress = byId("progress");
const caseLabel = byId("case");
const summary = byId("summary");
const status = byId("status");
const rowsHost = byId("rows");
const markdown = byId("markdown");

// The stage keeps its true size; only its preview is scaled to fit.
const scale = Math.min(1, 560 / stageWidth, 480 / stageHeight);
const rootStyle = document.documentElement.style;
rootStyle.setProperty("--stage-width", String(stageWidth));
rootStyle.setProperty("--stage-height", String(stageHeight));
rootStyle.setProperty("--scale", String(scale));

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      if (check()) {
        resolve(true);
      } else if (performance.now() - t0 > ms) {
        resolve(false);
      } else {
        setTimeout(tick, 30);
      }
    };
    tick();
  });
}

async function refreshInterval(): Promise<number> {
  const stamps: number[] = [];
  await new Promise<void>((resolve) => {
    const frame = (t: number) => {
      stamps.push(t);
      if (stamps.length < 40) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
  const deltas = stamps
    .slice(1)
    .map((t, i) => t - (stamps[i] ?? t))
    .sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)] ?? 16.7;
}

const median = (a: ReadonlyArray<number>) => {
  const sorted = a.slice().sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)] ?? NaN;
};
const mean = (a: ReadonlyArray<number>) =>
  a.length > 0 ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
const f = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : "—");

/** A running sky the bench samples: the core on its own canvas, or an element. */
interface Driver {
  stats(): SkyeStats | null;
  dispose(): void;
}

function caseParams(sc: Case, mode: Mode, quality: Quality) {
  return {
    scene: sc.scene,
    hour: sc.hour,
    seed: 3,
    motion: "full",
    quality,
    blur: mode === "blur" ? BLUR : undefined,
  } as const;
}

function mountElement(sc: Case, mode: Mode, quality: Quality): Driver {
  const el = document.createElement("skye-view");
  for (const [name, value] of Object.entries(toAttributes(caseParams(sc, mode, quality)))) {
    el.setAttribute(name, value);
  }
  el.setAttribute("worker", WORKER_URL);
  stage.append(el);
  return { stats: () => el.stats(), dispose: () => el.remove() };
}

function mountCore(sc: Case, mode: Mode, quality: Quality): Driver | null {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
  stage.append(canvas);
  try {
    const sky = createSky(canvas, caseParams(sc, mode, quality));
    sky.resize(stageWidth, stageHeight, window.devicePixelRatio);
    sky.probe(true);
    sky.start();
    return {
      stats: () => sky.stats(),
      dispose: () => {
        sky.dispose();
        // Free the context now: dozens of cases would otherwise exceed the browser's context limit.
        canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
        canvas.remove();
      },
    };
  } catch {
    canvas.remove();
    return null;
  }
}

async function measure(
  sc: Case,
  mode: Mode,
  quality: Quality,
  worker: boolean,
  refresh: number,
): Promise<Row | null> {
  stage.replaceChildren();
  const driver = worker ? mountElement(sc, mode, quality) : mountCore(sc, mode, quality);
  if (driver === null) {
    return null;
  }
  const started = await waitFor(() => (driver.stats()?.out[0] ?? 0) > 0, 5000);
  if (!started) {
    driver.dispose();
    return null;
  }
  await sleep(WARM_MS);
  const gpu: number[] = [];
  const cpu: number[] = [];
  let rafCount = 0;
  let longs = 0;
  let last = 0;
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const frame = (now: number) => {
      rafCount++;
      if (last > 0 && now - last > 1.6 * refresh) {
        longs++;
      }
      last = now;
      const s = driver.stats();
      if (s !== null && s.gpuMs >= 0) {
        gpu.push(s.gpuMs);
      }
      if (s !== null && s.cpuMs >= 0) {
        cpu.push(s.cpuMs);
      }
      if (now - t0 < MEASURE_MS) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
  const stats: SkyeStats | null = driver.stats();
  driver.dispose();
  if (stats === null) {
    return null;
  }
  return {
    scene: sc.label,
    tier: quality === "auto" ? `auto→${stats.quality}` : quality,
    mode: mode === "blur" ? "background" : "weather tab",
    buffers: `sky ${stats.sky[0]}×${stats.sky[1]} · scene ${stats.scene[0]}×${stats.scene[1]} · out ${stats.out[0]}×${stats.out[1]}`,
    gpu: median(gpu),
    cpu: median(cpu),
    fps: stats.fps,
    drops: rafCount > 0 ? longs / rafCount : 0,
    mpx: stats.mpx,
    samples: gpu.length,
    worker: stats.worker,
    workerRequested: worker,
  };
}

function cell(className: string, text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function rowMethod(r: Row, date: string): string {
  const where = r.worker
    ? "worker"
    : r.workerRequested
      ? "main thread, worker unavailable"
      : "main thread";
  return `bench page, ${date}, ${stageWidth}×${stageHeight}, ${where}`;
}

function renderRows(rows: ReadonlyArray<Row>): void {
  rowsHost.replaceChildren(
    ...rows.map((r) => {
      const row = document.createElement("div");
      row.className = "row";
      row.append(
        cell("case", r.scene),
        cell("", r.tier),
        cell("", r.mode),
        cell("buffers", r.buffers),
        cell("num", f(r.gpu)),
        cell("num", f(r.cpu)),
        cell("num", f(r.fps, 0)),
        cell("num", `${f(r.drops * 100, 0)}%`),
        cell("num", f(r.mpx)),
      );
      return row;
    }),
  );
  const date = new Date().toISOString().slice(0, 10);
  const header = [
    "| Tier | Mode | Scene | GPU ms | CPU ms | fps | Mpx | Method | Status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const body = rows.map(
    (r) =>
      `| \`${r.tier}\` | ${r.mode} | ${r.scene} | ${f(r.gpu)} | ${f(r.cpu)} | ${f(r.fps, 0)} | ${f(r.mpx)} | ${rowMethod(r, date)} | measured |`,
  );
  markdown.textContent = [...header, ...body].join("\n");
}

function statTile(label: string, value: string, unit: string, sub: string): HTMLDivElement {
  const tile = document.createElement("div");
  tile.className = "stat";
  const valueEl = cell("statValue", value);
  valueEl.append(cell("statUnit", unit));
  tile.append(cell("statLabel", label), valueEl, cell("statSub", sub));
  return tile;
}

function renderSummary(rows: ReadonlyArray<Row>): void {
  const tiles: HTMLDivElement[] = [];
  for (const mode of ["weather tab", "background"]) {
    for (const tier of ["low", "balanced", "high"]) {
      const subset = rows.filter((r) => r.mode === mode && r.tier === tier && r.samples > 0);
      if (subset.length === 0) {
        continue;
      }
      tiles.push(
        statTile(
          `${mode} · ${tier}`,
          f(mean(subset.map((r) => r.gpu))),
          "ms GPU",
          `${f(mean(subset.map((r) => r.mpx)))} Mpx · ${f(mean(subset.map((r) => r.fps)), 0)} fps over ${subset.length} scenes`,
        ),
      );
    }
  }
  summary.replaceChildren(...tiles);
  status.textContent =
    rows.length === 0
      ? "No case produced a result"
      : rows.some((r) => r.samples > 0)
        ? "Done"
        : "Done. No GPU time was measured: it needs a GPU timer (in worker mode, also quality auto)";
}

async function run(): Promise<void> {
  runButton.disabled = true;
  status.textContent = "Measuring display refresh";
  summary.replaceChildren();
  defineSkye();
  const refresh = await refreshInterval();
  const probe = document.createElement("canvas").getContext("webgl2");
  const timer = probe !== null && probe.getExtension("EXT_disjoint_timer_query_webgl2") !== null;
  const worker = workerSelect.value === "worker";
  setup.textContent = `Stage ${stageWidth}×${stageHeight} CSS px (set with ?w= and ?h=) · dpr ${window.devicePixelRatio.toFixed(2)} · display ${Math.round(1000 / refresh)} Hz · GPU timer ${timer ? "available" : "unavailable"} · ${worker ? "worker" : "main thread"}. Each case warms up ${(WARM_MS / 1000).toFixed(1)} s, then measures ${(MEASURE_MS / 1000).toFixed(1)} s.`;
  const tiers = tierSelect.value === "auto" ? TIERS.filter((t) => t === "auto") : TIERS;
  const cases: Array<{ sc: Case; mode: Mode; quality: Quality }> = [];
  for (const mode of ["sharp", "blur"] as const) {
    for (const quality of tiers) {
      for (const sc of SCENES) {
        cases.push({ sc, mode, quality });
      }
    }
  }
  const rows: Row[] = [];
  status.textContent = "Running";
  for (const [i, c] of cases.entries()) {
    caseLabel.textContent = `${c.quality} · ${c.mode === "blur" ? "background" : "weather tab"} · ${c.sc.label}`;
    fill.style.width = `${Math.round((i / cases.length) * 100)}%`;
    progress.textContent = `${i}/${cases.length}`;
    // oxlint-disable-next-line no-await-in-loop -- the cases share one GPU and must run one at a time
    const row = await measure(c.sc, c.mode, c.quality, worker, refresh);
    if (row !== null) {
      rows.push(row);
      renderRows(rows);
    }
  }
  fill.style.width = "100%";
  progress.textContent = `${cases.length}/${cases.length}`;
  caseLabel.textContent = "done";
  renderSummary(rows);
  runButton.disabled = false;
}

runButton.addEventListener("click", () => {
  void run();
});

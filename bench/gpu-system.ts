// System-level probes for the GPU bench runner, all readable without root on macOS:
// - ioreg: IOAccelerator's PerformanceStatistics (GPU device/renderer/tiler utilisation, GPU-visible memory).
// - ps: CPU time and resident memory of each Chromium process (browser, GPU, renderer, utility).
// - top: per-process CPU and "POWER", the energy-impact estimate Activity Monitor shows.
// - pmset: thermal and power-source state.
// - DevTools protocol: per-process CPU time, page metrics, sampled allocations, and a trace for GC and
//   main-thread work.
// Utilisation and power are system-wide or per process, not per page: other activity on the machine shows up
// in them, which is why every figure is reported next to an idle baseline taken in the same run.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { CDPSession } from "playwright";

const run = promisify(execFile);

async function sh(cmd: string, args: string[]): Promise<string> {
  try {
    return (await run(cmd, args, { maxBuffer: 16 * 2 ** 20 })).stdout;
  } catch {
    return "";
  }
}

const mean = (a: ReadonlyArray<number>) =>
  a.length > 0 ? a.reduce((s, v) => s + v, 0) / a.length : NaN;

// --------------------------------------------------------------------------------------------------------------
// ioreg

interface IoregSample {
  device: number;
  renderer: number;
  tiler: number;
  inUseMemory: number;
}

export interface IoregSummary {
  samples: number;
  device: number;
  deviceMax: number;
  renderer: number;
  tiler: number;
  inUseMemoryMB: number;
}

async function ioreg(): Promise<IoregSample | null> {
  const stdout = await sh("ioreg", ["-r", "-d", "1", "-c", "IOAccelerator"]);
  const line = stdout.split("\n").find((l) => l.includes('"PerformanceStatistics"'));
  if (line === undefined) return null;
  const read = (key: string) => {
    const m = new RegExp(`"${key.replace(/[%()]/g, "\\$&")}"=(\\d+)`).exec(line);
    return m === null ? NaN : Number(m[1]);
  };
  return {
    device: read("Device Utilization %"),
    renderer: read("Renderer Utilization %"),
    tiler: read("Tiler Utilization %"),
    inUseMemory: read("In use system memory"),
  };
}

// --------------------------------------------------------------------------------------------------------------
// ps

export interface ProcessSample {
  /** Process type from Chromium's --type flag: "browser", "gpu-process", "renderer", "utility". */
  type: string;
  pid: number;
  /** User plus system CPU seconds since the process started. */
  cpuSeconds: number;
  rssKB: number;
}

function cpuTime(s: string): number {
  // "M:SS.ss" or "H:MM:SS.ss"
  return s.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

/** Every Chromium process Playwright launched, from `ps`. */
export async function chromiumProcesses(): Promise<ProcessSample[]> {
  const out = await sh("ps", ["-axo", "pid=,rss=,time=,command="]);
  const list: ProcessSample[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/.exec(line);
    if (m === null) continue;
    const command = m[4] ?? "";
    if (!command.includes("ms-playwright/chromium")) continue;
    const type = /--type=([\w-]+)/.exec(command)?.[1] ?? "browser";
    list.push({ type, pid: Number(m[1]), cpuSeconds: cpuTime(m[3] ?? "0"), rssKB: Number(m[2]) });
  }
  return list;
}

export interface ProcessLoad {
  /** CPU % per process type over the window (100 = one core). */
  cpu: Record<string, number>;
  /** Resident MB per process type at the end of the window. */
  rssMB: Record<string, number>;
}

export function processLoad(a: ProcessSample[], b: ProcessSample[], seconds: number): ProcessLoad {
  const before = new Map(a.map((p) => [p.pid, p.cpuSeconds]));
  const cpu: Record<string, number> = {};
  const rssMB: Record<string, number> = {};
  for (const p of b) {
    const d = p.cpuSeconds - (before.get(p.pid) ?? p.cpuSeconds);
    cpu[p.type] = (cpu[p.type] ?? 0) + (d / seconds) * 100;
    rssMB[p.type] = (rssMB[p.type] ?? 0) + p.rssKB / 1024;
  }
  return { cpu, rssMB };
}

// --------------------------------------------------------------------------------------------------------------
// top: CPU % and energy impact ("POWER") per process, sampled once a second.

export interface PowerSummary {
  samples: number;
  /** Mean summed POWER over Chromium's processes. */
  power: number;
  /** Mean summed %CPU over Chromium's processes, as top reports it. */
  cpu: number;
}

class TopSampler {
  readonly #rows: Array<{ cpu: number; power: number }> = [];
  #child: ReturnType<typeof spawn> | null = null;
  #done: Promise<void> = Promise.resolve();

  start(pids: number[], seconds: number): void {
    this.#rows.length = 0;
    if (pids.length === 0) return;
    const args = ["-l", String(Math.ceil(seconds) + 1), "-s", "1", "-stats", "pid,cpu,power"];
    for (const pid of pids) args.push("-pid", String(pid));
    const child = spawn("top", args, { stdio: ["ignore", "pipe", "ignore"] });
    this.#child = child;
    let text = "";
    child.stdout?.on("data", (d: Buffer) => {
      text += d.toString();
    });
    this.#done = new Promise((resolve) => {
      child.on("close", () => {
        // One block per sample, each starting with the column header; the first block has no rates yet.
        const blocks = text.split(/^PID\s+%CPU\s+POWER\s*$/m).slice(2);
        for (const block of blocks) {
          let cpu = 0;
          let power = 0;
          for (const line of block.split("\n")) {
            const m = /^\s*\d+\s+([\d.]+)\s+([\d.]+)/.exec(line);
            if (m === null) continue;
            cpu += Number(m[1]);
            power += Number(m[2]);
          }
          this.#rows.push({ cpu, power });
        }
        resolve();
      });
    });
  }

  async stop(): Promise<PowerSummary | null> {
    this.#child?.kill("SIGINT");
    await this.#done;
    this.#child = null;
    if (this.#rows.length === 0) return null;
    return {
      samples: this.#rows.length,
      power: mean(this.#rows.map((r) => r.power)),
      cpu: mean(this.#rows.map((r) => r.cpu)),
    };
  }
}

// --------------------------------------------------------------------------------------------------------------
// DevTools protocol

/** CPU seconds per Chromium process type, as the browser itself reports them. */
export async function cdpProcessTimes(cdp: CDPSession | null): Promise<Map<string, number> | null> {
  if (cdp === null) return null;
  try {
    const r = (await cdp.send("SystemInfo.getProcessInfo")) as {
      processInfo: Array<{ type: string; cpuTime: number }>;
    };
    const m = new Map<string, number>();
    for (const p of r.processInfo) m.set(p.type, (m.get(p.type) ?? 0) + p.cpuTime);
    return m;
  } catch {
    return null;
  }
}

/** Page metrics: ScriptDuration, TaskDuration, LayoutDuration, RecalcStyleDuration (s), JSHeapUsedSize (B), ... */
export async function pageMetrics(cdp: CDPSession): Promise<Map<string, number>> {
  const r = await cdp.send("Performance.getMetrics");
  return new Map(r.metrics.map((m) => [m.name, m.value]));
}

export interface PageLoad {
  /** Share of wall time the page's main thread spent in tasks, scripts, layout and style (100 = always busy). */
  taskPct: number;
  scriptPct: number;
  layoutPct: number;
  stylePct: number;
  heapStartMB: number;
  heapEndMB: number;
}

export function pageLoad(
  a: Map<string, number>,
  b: Map<string, number>,
  seconds: number,
): PageLoad {
  const d = (k: string) => (((b.get(k) ?? 0) - (a.get(k) ?? 0)) / seconds) * 100;
  return {
    taskPct: d("TaskDuration"),
    scriptPct: d("ScriptDuration"),
    layoutPct: d("LayoutDuration"),
    stylePct: d("RecalcStyleDuration"),
    heapStartMB: (a.get("JSHeapUsedSize") ?? NaN) / 2 ** 20,
    heapEndMB: (b.get("JSHeapUsedSize") ?? NaN) / 2 ** 20,
  };
}

interface ProfileNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: ProfileNode[];
}

export interface Allocations {
  /** Sampled bytes allocated per second of the window, by origin. */
  totalPerSecond: number;
  rendererPerSecond: number;
  harnessPerSecond: number;
  otherPerSecond: number;
  /** The functions under src/ that allocated most, "name file:line bytes/s". */
  topRenderer: string[];
}

/** Runs `body` under the sampling heap profiler and attributes what was allocated to src/, bench/ or elsewhere. */
export async function sampleAllocations(
  cdp: CDPSession,
  seconds: number,
  body: () => Promise<unknown>,
): Promise<Allocations> {
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.startSampling", {
    samplingInterval: 512,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  await body();
  const { profile } = (await cdp.send("HeapProfiler.stopSampling")) as {
    profile: { head: ProfileNode };
  };
  await cdp.send("HeapProfiler.disable");
  let renderer = 0;
  let harness = 0;
  let other = 0;
  const sites = new Map<string, number>();
  const walk = (n: ProfileNode, owner: { url: string; name: string } | null) => {
    const own =
      n.callFrame.url !== ""
        ? {
            url: n.callFrame.url,
            name: `${n.callFrame.functionName || "(anonymous)"} ${n.callFrame.url
              .replace(/^.*\/src\//, "src/")
              .replace(/^https?:\/\/[^/]+\//, "bench/")
              .replace(/\?.*$/, "")}`,
          }
        : owner;
    if (n.selfSize > 0) {
      const url = own?.url ?? "";
      // src/ comes through the dev server's /@fs/ paths; the bench's own modules are served from its root.
      if (url.includes("/src/")) {
        renderer += n.selfSize;
        const key = own?.name ?? "?";
        sites.set(key, (sites.get(key) ?? 0) + n.selfSize);
      } else if (
        /^https?:\/\/[^/]+\/(?!@fs\/|@vite|node_modules\/)/.test(url) ||
        url.includes("/test/")
      )
        harness += n.selfSize;
      else other += n.selfSize;
    }
    for (const c of n.children) walk(c, own);
  };
  walk(profile.head, null);
  return {
    totalPerSecond: (renderer + harness + other) / seconds,
    rendererPerSecond: renderer / seconds,
    harnessPerSecond: harness / seconds,
    otherPerSecond: other / seconds,
    topRenderer: [...sites.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${k} ${Math.round(v / seconds)} B/s`),
  };
}

export const TRACE_CATEGORIES: string[] = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "v8",
  "disabled-by-default-v8.gc",
  "gpu",
  "toplevel",
  "blink",
  "cc",
  "viz",
];

interface TraceEvent {
  name: string;
  ph: string;
  pid: number;
  tid: number;
  ts: number;
  dur?: number;
  args?: { name?: string };
}

export interface TraceSummary {
  seconds: number;
  minorGcs: number;
  majorGcs: number;
  gcMs: number;
  gcMaxMs: number;
  /** Busy share of each thread of interest (top-level task time / wall), 100 = always busy. */
  busyPct: Record<string, number>;
  /** Page main-thread time by kind, percent of wall. */
  mainScriptPct: number;
  mainRenderPct: number;
  longTasks: number;
}

const THREADS = [
  "CrRendererMain",
  "DedicatedWorker thread",
  "Compositor",
  "CrGpuMain",
  "VizCompositorThread",
  "CrBrowserMain",
];

/** GC counts and pauses, per-thread busy time and the main thread's script/render split, from a trace. */
export function summarizeTrace(json: Buffer): TraceSummary {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Chromium's trace format, read as written
  const parsed = JSON.parse(json.toString()) as { traceEvents: TraceEvent[] } | TraceEvent[];
  const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  const threadName = new Map<string, string>();
  for (const e of events) {
    if (e.ph === "M" && e.name === "thread_name" && e.args?.name !== undefined)
      threadName.set(`${e.pid}:${e.tid}`, e.args.name);
  }
  const complete = events.filter((e) => e.ph === "X" && typeof e.dur === "number");
  const ts = complete.map((e) => e.ts);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...complete.map((e) => e.ts + (e.dur ?? 0)));
  const seconds = Math.max(1e-3, (t1 - t0) / 1e6);
  const gcs = complete.filter((e) => e.name === "MinorGC" || e.name === "MajorGC");
  const busy: Record<string, number> = {};
  let mainScript = 0;
  let mainRender = 0;
  let longTasks = 0;
  for (const e of complete) {
    const thread = threadName.get(`${e.pid}:${e.tid}`) ?? "";
    const base = THREADS.find((t) => thread.startsWith(t));
    if (base === undefined) continue;
    const dur = (e.dur ?? 0) / 1000;
    // Top-level task markers: one per task, so their durations do not overlap.
    if (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask") {
      busy[base] = (busy[base] ?? 0) + dur;
      if (base === "CrRendererMain" && dur > 50) longTasks++;
    }
    if (base === "CrRendererMain") {
      if (
        e.name === "FunctionCall" ||
        e.name === "FireAnimationFrame" ||
        e.name === "TimerFire" ||
        e.name === "EventDispatch"
      )
        mainScript += dur;
      if (
        e.name === "UpdateLayoutTree" ||
        e.name === "Layout" ||
        e.name === "Paint" ||
        e.name === "PrePaint" ||
        e.name === "Commit" ||
        e.name === "Layerize"
      )
        mainRender += dur;
    }
  }
  const pct = (ms: number) => (ms / 1000 / seconds) * 100;
  const busyPct: Record<string, number> = {};
  for (const [k, v] of Object.entries(busy)) busyPct[k] = pct(v);
  const gcDur = gcs.map((e) => (e.dur ?? 0) / 1000);
  return {
    seconds,
    minorGcs: gcs.filter((e) => e.name === "MinorGC").length,
    majorGcs: gcs.filter((e) => e.name === "MajorGC").length,
    gcMs: gcDur.reduce((a, b) => a + b, 0),
    gcMaxMs: gcDur.length > 0 ? Math.max(...gcDur) : 0,
    busyPct,
    mainScriptPct: pct(mainScript),
    mainRenderPct: pct(mainRender),
    longTasks,
  };
}

// --------------------------------------------------------------------------------------------------------------
// One measured window: everything above that can run beside the page, started and stopped together.

export interface WindowResult {
  seconds: number;
  ioreg: IoregSummary | null;
  process: ProcessLoad | null;
  /** CPU % per process type from the browser's own accounting (DevTools SystemInfo). */
  cdpCpu: Record<string, number> | null;
  power: PowerSummary | null;
  page: PageLoad | null;
}

export class SystemWindow {
  readonly #cdp: CDPSession | null;
  readonly #page: CDPSession | null;
  readonly #ioreg: IoregSample[] = [];
  readonly #top = new TopSampler();
  #running = false;
  #loop: Promise<void> = Promise.resolve();
  #t0 = 0;
  #ps: ProcessSample[] = [];
  #cdpTimes: Map<string, number> | null = null;
  #metrics: Map<string, number> | null = null;

  constructor(browserCdp: CDPSession | null, pageCdp: CDPSession | null) {
    this.#cdp = browserCdp;
    this.#page = pageCdp;
  }

  async start(expectedSeconds: number): Promise<void> {
    this.#ioreg.length = 0;
    this.#ps = await chromiumProcesses();
    this.#cdpTimes = await cdpProcessTimes(this.#cdp);
    this.#metrics = this.#page === null ? null : await pageMetrics(this.#page);
    this.#top.start(
      this.#ps.map((p) => p.pid),
      expectedSeconds,
    );
    this.#running = true;
    this.#t0 = performance.now();
    this.#loop = (async () => {
      while (this.#running) {
        const t = performance.now();
        // oxlint-disable-next-line no-await-in-loop -- one sample at a time, at a steady rate
        const s = await ioreg();
        if (s !== null) this.#ioreg.push(s);
        // oxlint-disable-next-line no-await-in-loop -- see above
        await new Promise((r) => setTimeout(r, Math.max(0, 250 - (performance.now() - t))));
      }
    })();
  }

  async stop(): Promise<WindowResult> {
    const seconds = (performance.now() - this.#t0) / 1000;
    this.#running = false;
    const [ps, cdpTimes, metrics, power] = await Promise.all([
      chromiumProcesses(),
      cdpProcessTimes(this.#cdp),
      this.#page === null ? Promise.resolve(null) : pageMetrics(this.#page),
      this.#top.stop(),
      this.#loop,
    ]);
    const s = this.#ioreg;
    let cdpCpu: Record<string, number> | null = null;
    if (this.#cdpTimes !== null && cdpTimes !== null) {
      cdpCpu = {};
      for (const [k, v] of cdpTimes)
        cdpCpu[k] = ((v - (this.#cdpTimes.get(k) ?? v)) / seconds) * 100;
    }
    return {
      seconds,
      ioreg:
        s.length === 0
          ? null
          : {
              samples: s.length,
              device: mean(s.map((x) => x.device)),
              deviceMax: Math.max(...s.map((x) => x.device)),
              renderer: mean(s.map((x) => x.renderer)),
              tiler: mean(s.map((x) => x.tiler)),
              inUseMemoryMB: mean(s.map((x) => x.inUseMemory)) / 2 ** 20,
            },
      process: this.#ps.length > 0 ? processLoad(this.#ps, ps, seconds) : null,
      cdpCpu,
      power,
      page:
        this.#metrics === null || metrics === null
          ? null
          : pageLoad(this.#metrics, metrics, seconds),
    };
  }
}

/** Thermal and power-source state, as pmset reports it. */
export async function thermal(): Promise<{ therm: string; source: string }> {
  const therm = (await sh("pmset", ["-g", "therm"])).trim().replace(/\s*\n\s*/g, "; ");
  const source = /Now drawing from '([^']+)'/.exec(await sh("pmset", ["-g", "batt"]))?.[1] ?? "?";
  return { therm, source };
}

export async function machine(): Promise<{ cpu: string; gpu: string; os: string }> {
  return {
    cpu: (await sh("sysctl", ["-n", "machdep.cpu.brand_string"])).trim(),
    gpu:
      /Chipset Model: (.*)/.exec(await sh("system_profiler", ["SPDisplaysDataType"]))?.[1] ?? "?",
    os: (await sh("sw_vers", ["-productVersion"])).trim(),
  };
}

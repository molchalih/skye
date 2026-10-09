// Turns results.json into report.md: one table per cost axis, then the largest costs ranked across axes.
import type { CaseResult, ElementPathResult, Results } from "./gpu-results.ts";
import type { WindowResult } from "./gpu-system.ts";

const f = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d);
const mb = (bytes: number) => (bytes / 2 ** 20).toFixed(1);
const kb = (bytes: number) => (bytes / 1024).toFixed(1);
const delta = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) || b === 0
    ? "—"
    : `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(0)}%`;

function table(head: string[], rows: string[][]): string {
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

const PASSES = ["sky", "composite", "particles", "mipmap", "rays", "glass", "blur"];

function median(a: number[]): number {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? NaN;
}

function cpu(w: WindowResult, type: string): number | undefined {
  return w.process?.cpu[type];
}

function written(c: CaseResult): number {
  return c.passes.passes.reduce(
    (a, p) => a + p.bytesWritten * (p.frames / Math.max(1, c.passes.frames)),
    0,
  );
}

function environment(r: Results, lines: string[]): void {
  const idle = r.idle;
  lines.push(`# skye runtime cost bench, ${r.date}`);
  lines.push("");
  lines.push(
    `${r.machine.gpu} (${r.machine.cpu}), macOS ${r.machine.os}, ${r.thermal.start.source}; ${r.browser.version} ${r.browser.mode}; ` +
      `WebGL: ${r.env.renderer}; GPU timer: ${r.env.timer ? `TIME_ELAPSED ${r.env.timerBits} bits, TIMESTAMP ${r.env.timestampBits} bits` : "unavailable"}; ` +
      `display interval ${f(r.env.refreshMs)} ms; cross-origin isolated: ${r.env.crossOriginIsolated ? "yes (5 µs timers)" : "no (100 µs timers)"}; ` +
      `KHR_parallel_shader_compile: ${r.env.parallelCompile ? "yes" : "no"}.`,
  );
  lines.push("");
  lines.push(`Thermal at start: ${r.thermal.start.therm}. At end: ${r.thermal.end.therm}.`);
  lines.push("");
  lines.push(
    `Idle baseline (bench page open, nothing drawing, ${f(idle.seconds, 1)} s): ioreg device ${f(idle.ioreg?.device, 1)} %, ` +
      `renderer ${f(idle.ioreg?.renderer, 1)} %, GPU memory in use ${f(idle.ioreg?.inUseMemoryMB, 0)} MB; Chromium CPU: ` +
      `GPU process ${f(cpu(idle, "gpu-process"), 1)} %, renderer ${f(cpu(idle, "renderer"), 1)} %, browser ${f(cpu(idle, "browser"), 1)} %; ` +
      `top POWER (all Chromium processes) ${f(idle.power?.power, 1)}. The same window after the run: ioreg device ` +
      `${f(r.idleAfter.ioreg?.device, 1)} %, GPU memory ${f(r.idleAfter.ioreg?.inUseMemoryMB, 0)} MB, POWER ${f(r.idleAfter.power?.power, 1)}. ` +
      "ioreg is system-wide: the gap between the two idle windows is the noise floor for every ioreg figure below.",
  );
  lines.push("");
}

function startup(r: Results, lines: string[]): void {
  const s = r.startup;
  if (s === null) return;
  lines.push("## Startup");
  lines.push("");
  lines.push(
    `The core bundled into one minified ES module (${s.bundle.bytes} B, ${s.bundle.gzip} B gzip, ${s.bundle.brotli} B brotli), ` +
      `imported from a blob into a fresh page, then createSky at ${s.input.width}×${s.input.height}, ${s.input.tier}. ` +
      "Cold: a new browser, so an empty GPU program cache. Warm: a new page in that browser. Medians.",
  );
  lines.push("");
  const row = (label: string, list: typeof s.cold) => [
    label,
    String(list.length),
    f(median(list.map((x) => x.importMs))),
    f(median(list.map((x) => x.createMs))),
    f(median(list.map((x) => x.readyMs))),
    f(median(list.map((x) => x.firstRenderMs)), 3),
    f(median(list.map((x) => x.firstFrameMs))),
    f(median(list.map((x) => x.heapMB)), 2),
  ];
  lines.push(
    table(
      [
        "start",
        "runs",
        "import ms",
        "createSky ms",
        "ready ms (compile+link)",
        "first render CPU ms",
        "first frame ms",
        "heap MB",
      ],
      [row("cold", s.cold), row("warm", s.warm)],
    ),
  );
  lines.push("");
}

function gpu(r: Results, lines: string[]): void {
  lines.push("## GPU");
  lines.push("");
  lines.push(
    "Two views of GPU cost. *Paced GPU*: a TIME_ELAPSED query around each frame drawn once per animation frame: how " +
      "long the GPU is busy per frame at the clock this light load leaves it at (Apple GPUs clock down, so this reads " +
      "several times the full-clock cost; it is the figure that tracks energy). *Saturated*: frames drawn back to back, " +
      "then a one-pixel read waits for the GPU: wall ms per frame at full clock, the throughput cost. ioreg device % is " +
      "system-wide, a mean over the paced phase; Δ is against the idle window.",
  );
  lines.push("");
  lines.push(
    table(
      [
        "case",
        "canvas px",
        "paced GPU p50",
        "p95",
        "p99",
        "saturated ms/frame",
        "ioreg %",
        "Δ idle",
        "renderer %",
        "tiler %",
        "Mpx/frame",
        "written MB/frame",
      ],
      r.cases.map((c) => [
        c.id,
        `${c.prepared.out[0]}×${c.prepared.out[1]}`,
        f(c.paced.gpu?.p50),
        f(c.paced.gpu?.p95),
        f(c.paced.gpu?.p99),
        f(c.saturated.msPerFrame, 3),
        f(c.system.ioreg?.device, 1),
        f((c.system.ioreg?.device ?? NaN) - (r.idle.ioreg?.device ?? NaN), 1),
        f(c.system.ioreg?.renderer, 1),
        f(c.system.ioreg?.tiler, 1),
        f(c.paced.mpx),
        mb(written(c)),
      ]),
    ),
  );
  lines.push("");
  lines.push("### Per pass");
  lines.push("");
  lines.push(
    "Two estimates, ms. *query*: p50 of one TIME_ELAPSED query per pass, paced; every boundary is a separate GPU " +
      "submission at a low clock, so each pass carries a fixed overhead and the sum far exceeds the whole frame: use it " +
      "to rank, not to add. *marg.*: frames drawn back to back at full clock with the pass's draws issued " +
      `${Math.round(Number(r.settings["repeat"]) / 2)} and then ${String(r.settings["repeat"])} times; the slope of wall ms per frame ` +
      "is the pass's own GPU cost at full clock, with no split. Values within about ±0.01 ms are noise. *saturated " +
      "frame* is the whole frame at full clock: what remains after the passes is fixed per-frame overhead (render-pass " +
      "setup, submission). A dash means the pass did not run.",
  );
  lines.push("");
  lines.push(
    table(
      [
        "case",
        ...PASSES.map((p) => `${p} query / marg.`),
        "query sum",
        "paced frame",
        "saturated frame",
      ],
      r.cases.map((c) => {
        const by = new Map(c.passes.passes.map((p) => [p.name, p]));
        const marg = new Map((c.marginal?.passes ?? []).map((p) => [p.name, p.ms]));
        return [
          c.id,
          ...PASSES.map((n) => {
            const p = by.get(n);
            return p === undefined ? "—" : `${f(p.gpu?.p50, 3)} / ${f(marg.get(n), 3)}`;
          }),
          f(c.passes.sumP50, 3),
          f(c.paced.gpu?.p50, 3),
          f(c.marginal?.baseMs, 3),
        ];
      }),
    ),
  );
  lines.push("");
  lines.push("### Fill per pass (first case of each size and tier)");
  lines.push("");
  const seen = new Set<string>();
  lines.push(
    table(
      ["case", "pass", "draws", "instances", "Mpx", "MB written", "targets"],
      r.cases
        .filter((c) => {
          const key = `${c.prepared.out.join("x")}-${c.input.tier}-${c.input.scene}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .flatMap((c) =>
          c.passes.passes.map((p) => [
            c.id,
            p.name,
            f(p.draws, 0),
            f(p.instances, 0),
            f(p.pixels / 1e6, 2),
            mb(p.bytesWritten),
            p.targets.join(", "),
          ]),
        ),
    ),
  );
  lines.push("");
}

function cpuAxis(r: Results, lines: string[]): void {
  lines.push("## CPU");
  lines.push("");
  lines.push(
    "render CPU: JS time of one `render(t)` call (the renderer's whole per-frame JS, GL submission included). Main " +
      "thread %: DevTools Performance metrics over the paced phase (the harness's own per-frame bookkeeping included). " +
      "Process CPU: `ps` CPU time per Chromium process type over the paced phase, 100 % = one core. Busy %: share of " +
      "the trace window each thread spent in tasks.",
  );
  lines.push("");
  lines.push(
    table(
      [
        "case",
        "render CPU p50",
        "p95",
        "p99",
        "frame interval p50",
        "p95",
        "p99",
        "dropped",
        "long tasks",
        "main task %",
        "script %",
        "renderer proc %",
        "GPU proc %",
        "browser %",
        "GPU main busy %",
        "viz busy %",
      ],
      r.cases.map((c) => [
        c.id,
        f(c.paced.cpu.p50, 3),
        f(c.paced.cpu.p95, 3),
        f(c.paced.cpu.p99, 3),
        f(c.paced.interval.p50),
        f(c.paced.interval.p95),
        f(c.paced.interval.p99),
        `${c.paced.dropped} (${f(c.paced.droppedShare * 100, 1)} %)`,
        String(c.paced.longTasks),
        f(c.system.page?.taskPct, 1),
        f(c.system.page?.scriptPct, 1),
        f(cpu(c.system, "renderer"), 1),
        f(cpu(c.system, "gpu-process"), 1),
        f(cpu(c.system, "browser"), 1),
        f(c.trace?.busyPct["CrGpuMain"], 1),
        f(c.trace?.busyPct["VizCompositorThread"], 1),
      ]),
    ),
  );
  lines.push("");
  lines.push("### GL calls per frame");
  lines.push("");
  lines.push(
    "From the counting proxy on the context. *sync-capable*: calls that can wait for the GPU process in Chromium; in the " +
      "steady state it should be 0.",
  );
  lines.push("");
  const first = new Map<string, CaseResult>();
  for (const c of r.cases)
    if (!first.has(`${c.input.scene}-${c.input.tier}`))
      first.set(`${c.input.scene}-${c.input.tier}`, c);
  lines.push(
    table(
      [
        "scene, tier",
        "total",
        "draws",
        "program switches",
        "uniforms",
        "bindings",
        "state",
        "uploads",
        "sync-capable",
        "most frequent",
      ],
      [...first.values()].map((c) => {
        const p = c.paced.calls.perFrame;
        return [
          `${c.input.scene} ${c.input.tier}`,
          f(p["total"], 1),
          f(p["draws"], 1),
          f(p["programSwitches"], 1),
          f(p["uniforms"], 1),
          f(p["bindings"], 1),
          f(p["state"], 1),
          f(p["uploads"], 1),
          f(p["syncCapable"], 1),
          c.paced.calls.top
            .slice(0, 6)
            .map(([k, v]) => `${k} ${f(v, 1)}`)
            .join(", "),
        ];
      }),
    ),
  );
  lines.push("");
}

function memory(r: Results, lines: string[]): void {
  lines.push("## Memory");
  lines.push("");
  lines.push(
    "Render targets: the renderer's own textures, mip chains included, from the wrapped allocations. Canvas: one RGBA8 " +
      "drawing buffer (the compositor holds more). Allocations: the sampling heap profiler (512 B interval) over a paced " +
      "window, attributed to src/ (renderer), bench/ (harness) or elsewhere (V8, DOM, DevTools); renderer bytes per " +
      "frame should be 0. GC: from a trace of the same length. RSS: `ps`, end of the paced phase.",
  );
  lines.push("");
  lines.push(
    table(
      [
        "case",
        "RT MB",
        "buffers KB",
        "canvas MB",
        "GPU mem Δ idle MB",
        "heap start→end MB",
        "renderer B/frame",
        "harness B/frame",
        "other B/s",
        "minor GC",
        "major GC",
        "GC ms",
        "renderer RSS MB",
        "GPU proc RSS MB",
      ],
      r.cases.map((c) => {
        const fps = c.paced.fps;
        const a = c.allocations;
        return [
          c.id,
          mb(c.prepared.targetBytes),
          kb(c.prepared.bufferBytes),
          mb(c.prepared.canvasBytes),
          f((c.system.ioreg?.inUseMemoryMB ?? NaN) - (r.idle.ioreg?.inUseMemoryMB ?? NaN), 0),
          `${f(c.paced.heapStartMB)}→${f(c.paced.heapEndMB)}`,
          a === null ? "—" : f(a.rendererPerSecond / fps, 1),
          a === null ? "—" : f(a.harnessPerSecond / fps, 0),
          a === null ? "—" : f(a.otherPerSecond, 0),
          c.trace === null ? "—" : String(c.trace.minorGcs),
          c.trace === null ? "—" : String(c.trace.majorGcs),
          c.trace === null ? "—" : f(c.trace.gcMs, 2),
          f(c.system.process?.rssMB["renderer"], 0),
          f(c.system.process?.rssMB["gpu-process"], 0),
        ];
      }),
    ),
  );
  const sites = r.cases.flatMap((c) => c.allocations?.topRenderer ?? []);
  if (sites.length > 0) {
    lines.push("");
    lines.push(
      `Renderer allocation sites seen: ${[...new Set(sites.map((s) => s.replace(/ \d+ B\/s$/, "")))].join("; ")}.`,
    );
  }
  lines.push("");
}

function energy(r: Results, lines: string[]): void {
  lines.push("## Energy proxies");
  lines.push("");
  lines.push(
    "`top`'s POWER column (the energy-impact estimate Activity Monitor shows; unitless, roughly CPU-% scaled with GPU " +
      "and wakeups) summed over Chromium's processes, beside ioreg GPU utilisation. Real watts need " +
      "`sudo powermetrics --samplers gpu_power,cpu_power`, which this bench does not run.",
  );
  lines.push("");
  lines.push(
    table(
      ["case", "POWER", "Δ idle", "top CPU %", "ioreg device %"],
      [
        [
          "idle",
          f(r.idle.power?.power, 1),
          "—",
          f(r.idle.power?.cpu, 1),
          f(r.idle.ioreg?.device, 1),
        ],
        ...r.cases.map((c) => [
          c.id,
          f(c.system.power?.power, 1),
          f((c.system.power?.power ?? NaN) - (r.idle.power?.power ?? NaN), 1),
          f(c.system.power?.cpu, 1),
          f(c.system.ioreg?.device, 1),
        ]),
      ],
    ),
  );
  lines.push("");
}

function elementAxis(r: Results, lines: string[]): void {
  if (r.element.length === 0) return;
  const input = r.element[0]?.input;
  lines.push("## Element: main thread vs worker, and idle states");
  lines.push("");
  lines.push(
    `A real \`<skye-view>\` (${input?.scene} ${input?.hour}h, ${input?.tier}, ${input?.width}×${input?.height} at ratio ${input?.dpr}) ` +
      "running its own loop. offscreen: moved out of the viewport (IntersectionObserver). hidden: `document.visibilityState` " +
      "overridden to hidden plus a visibilitychange event (the browser's own throttling of hidden tabs is not exercised). " +
      "static: `motion=static`. reduced-motion: `motion=auto` with the media feature emulated. Frames/s counts frames the " +
      "renderer drew; rAF/s counts the page's animation-frame requests (in worker mode the worker's own loop is not visible here).",
  );
  lines.push("");
  const rows = r.element.flatMap((p: ElementPathResult) =>
    p.states.map((s) => [
      p.path,
      s.state,
      f(s.counters.frames / s.counters.seconds, 1),
      f(s.counters.rafRequests / s.counters.seconds, 1),
      f(s.counters.calls.perFrame["total"], 1),
      f(s.system.page?.taskPct, 1),
      f(s.system.page?.scriptPct, 1),
      String(s.counters.longTasks),
      f(cpu(s.system, "renderer"), 1),
      f(cpu(s.system, "gpu-process"), 1),
      f(cpu(s.system, "browser"), 1),
      f(s.system.ioreg?.device, 1),
      f(s.system.power?.power, 1),
      `${f(s.counters.heapStartMB)}→${f(s.counters.heapEndMB)}`,
    ]),
  );
  lines.push(
    table(
      [
        "path",
        "state",
        "frames/s",
        "rAF/s",
        "GL calls/frame",
        "main task %",
        "script %",
        "long tasks",
        "renderer proc %",
        "GPU proc %",
        "browser %",
        "ioreg %",
        "POWER",
        "heap MB",
      ],
      rows,
    ),
  );
  lines.push("");
  lines.push(
    table(
      [
        "path (visible)",
        "renderer B/s",
        "harness B/s",
        "other B/s",
        "minor GC",
        "major GC",
        "GC ms",
        "main busy %",
        "worker busy %",
        "GPU main busy %",
        "main script %",
        "main render %",
      ],
      r.element.map((p) => [
        p.path,
        f(p.allocations?.rendererPerSecond, 0),
        f(p.allocations?.harnessPerSecond, 0),
        f(p.allocations?.otherPerSecond, 0),
        p.trace === null ? "—" : String(p.trace.minorGcs),
        p.trace === null ? "—" : String(p.trace.majorGcs),
        f(p.trace?.gcMs, 2),
        f(p.trace?.busyPct["CrRendererMain"], 1),
        f(p.trace?.busyPct["DedicatedWorker thread"], 1),
        f(p.trace?.busyPct["CrGpuMain"], 1),
        f(p.trace?.mainScriptPct, 1),
        f(p.trace?.mainRenderPct, 1),
      ]),
    ),
  );
  lines.push("");
}

function references(r: Results, baseline: Results | null, lines: string[]): void {
  lines.push("## Reference frames");
  lines.push("");
  const frames = Number(r.settings["refFrames"]);
  lines.push(
    `Frame ${frames - 1} (t = ${f((frames - 1) / 60, 3)} s) of a fresh sky, drawn twice to check it is deterministic, in frames/. ` +
      "With --baseline each is compared under the parity gate's tolerance: at least 99.9 % of " +
      "channels within 1/255 and none beyond 4/255.",
  );
  lines.push("");
  lines.push(
    table(
      [
        "case",
        "file",
        "size",
        "deterministic",
        ...(baseline === null
          ? []
          : ["parity", "within 1/255", "max diff", "GPU p50 Δ", "saturated Δ", "render CPU Δ"]),
      ],
      r.cases.map((c) => {
        const row = [
          c.id,
          c.reference.file,
          `${c.reference.width}×${c.reference.height}`,
          c.reference.deterministic ? "yes" : "NO",
        ];
        if (baseline !== null) {
          const b = baseline.cases.find((x) => x.id === c.id);
          const p = c.reference.parity;
          row.push(
            p === null ? "no baseline frame" : p.pass ? "pass" : "FAIL",
            p === null ? "—" : `${f(p.closePercent, 4)} %`,
            p === null ? "—" : String(p.maxDiff),
            delta(c.paced.gpu?.p50, b?.paced.gpu?.p50),
            delta(c.saturated.msPerFrame, b?.saturated.msPerFrame),
            delta(c.paced.cpu.p50, b?.paced.cpu.p50),
          );
        }
        return row;
      }),
    ),
  );
  lines.push("");
}

function hotspots(r: Results, lines: string[]): void {
  lines.push("## Largest costs, ranked from this run");
  lines.push("");
  const items: string[] = [];
  const biggest = [...r.cases].sort((a, b) => b.saturated.msPerFrame - a.saturated.msPerFrame)[0];
  if (biggest !== undefined && biggest.marginal !== null) {
    const total = biggest.marginal.passes.reduce((a, p) => a + Math.max(0, p.ms), 0);
    const ranked = [...biggest.marginal.passes].sort((a, b) => b.ms - a.ms);
    items.push(
      `GPU, heaviest case ${biggest.id} (${f(biggest.saturated.msPerFrame, 3)} ms/frame saturated, ${f(biggest.paced.gpu?.p50)} ms paced GPU): ` +
        ranked
          .map(
            (p) =>
              `${p.name} ${f(p.ms, 3)} ms (${f((Math.max(0, p.ms) / Math.max(1e-9, total)) * 100, 0)} %)`,
          )
          .join(", ") +
        " by marginal cost.",
    );
  }
  const procs = r.cases.map((c) => ({
    id: c.id,
    renderer: cpu(c.system, "renderer") ?? NaN,
    gpu: cpu(c.system, "gpu-process") ?? NaN,
    browser: cpu(c.system, "browser") ?? NaN,
  }));
  items.push(
    `CPU, median over cases: GPU process ${f(median(procs.map((p) => p.gpu)), 1)} %, renderer ${f(median(procs.map((p) => p.renderer)), 1)} %, ` +
      `browser ${f(median(procs.map((p) => p.browser)), 1)} % of a core (idle: ${f(cpu(r.idle, "gpu-process"), 1)} / ${f(cpu(r.idle, "renderer"), 1)} / ${f(cpu(r.idle, "browser"), 1)}); ` +
      `render() itself ${f(median(r.cases.map((c) => c.paced.cpu.p50)), 3)} ms p50.`,
  );
  const alloc = r.cases.filter((c) => (c.allocations?.rendererPerSecond ?? 0) > 0);
  items.push(
    alloc.length === 0
      ? "Allocations: the renderer allocated nothing measurable per frame in any case."
      : `Allocations: the renderer allocated in ${alloc.length} case(s), up to ${f(Math.max(...alloc.map((c) => (c.allocations?.rendererPerSecond ?? 0) / c.paced.fps)), 0)} B/frame: ${[...new Set(alloc.flatMap((c) => c.allocations?.topRenderer ?? []))].slice(0, 3).join("; ")}.`,
  );
  for (const p of r.element) {
    const awake = p.states.filter(
      (s) =>
        s.state !== "visible" &&
        (s.counters.frames > 1 || s.counters.rafRequests / s.counters.seconds > 1),
    );
    if (awake.length > 0) {
      items.push(
        `Idle states (${p.path}): ${awake.map((s) => `${s.state} still ${f(s.counters.frames / s.counters.seconds, 1)} frames/s, ${f(s.counters.rafRequests / s.counters.seconds, 1)} rAF/s`).join("; ")}.`,
      );
    }
  }
  if (r.startup !== null) {
    const c = r.startup.cold;
    items.push(
      `Startup (cold): ${f(median(c.map((x) => x.firstFrameMs)), 1)} ms to the first frame, of which ${f(median(c.map((x) => x.readyMs)), 1)} ms waiting for shader compile and link; import ${f(median(c.map((x) => x.importMs)), 1)} ms.`,
    );
  }
  for (const it of items) lines.push(`- ${it}`);
  lines.push("");
}

export function report(r: Results, baseline: Results | null): string {
  const lines: string[] = [];
  environment(r, lines);
  hotspots(r, lines);
  startup(r, lines);
  gpu(r, lines);
  cpuAxis(r, lines);
  memory(r, lines);
  energy(r, lines);
  elementAxis(r, lines);
  references(r, baseline, lines);
  return lines.join("\n");
}

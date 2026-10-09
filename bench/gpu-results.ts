// The shape of results.json, written by gpu-run.ts and read back by gpu-report.ts (and by --baseline).
import type {
  CaseInput,
  ElementState,
  EnvInfo,
  Marginal,
  Paced,
  Passes,
  Prepared,
  Reference,
  Saturated,
  StateCounters,
  Startup,
} from "./gpu-protocol.ts";
import type { Allocations, TraceSummary, WindowResult } from "./gpu-system.ts";

export interface CaseResult {
  id: string;
  input: CaseInput;
  prepared: Prepared;
  paced: Paced;
  /** System counters over the paced phase. */
  system: WindowResult;
  passes: Passes;
  marginal: Marginal | null;
  saturated: Saturated;
  allocations: Allocations | null;
  trace: TraceSummary | null;
  reference: Omit<Reference, "png"> & { file: string };
}

export interface StateResult {
  path: "main" | "worker";
  state: ElementState;
  counters: StateCounters;
  system: WindowResult;
}

export interface ElementPathResult {
  path: "main" | "worker";
  input: CaseInput;
  states: StateResult[];
  /** Allocation sampling and a trace in the visible state. */
  allocations: Allocations | null;
  trace: TraceSummary | null;
}

export interface StartupResult {
  bundle: { bytes: number; gzip: number; brotli: number };
  input: CaseInput;
  /** One per fresh browser: an empty GPU program cache. */
  cold: Startup[];
  /** Fresh pages in an already warm browser. */
  warm: Startup[];
}

export interface Results {
  date: string;
  machine: { cpu: string; gpu: string; os: string };
  browser: { version: string; mode: string; args: string[] };
  env: EnvInfo;
  thermal: { start: { therm: string; source: string }; end: { therm: string; source: string } };
  settings: Record<string, unknown>;
  idle: WindowResult;
  /** The same idle window again after everything else, to show how far the machine's background load drifted. */
  idleAfter: WindowResult;
  startup: StartupResult | null;
  cases: CaseResult[];
  element: ElementPathResult[];
}

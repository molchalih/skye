// The timer extension is not in every DOM typing; only the two enums are needed.
interface TimerQueryExt {
  readonly TIME_ELAPSED_EXT: GLenum;
  readonly GPU_DISJOINT_EXT: GLenum;
}

const MAX_IN_FLIGHT = 4;

/**
 * GPU frame time from `EXT_disjoint_timer_query_webgl2` (v6 `_probeBegin` /
 * `_probePoll`): one TIME_ELAPSED query per frame, harvested a few frames
 * later into a smoothed average. Queries are pooled and reused.
 */
export class GpuTimer {
  /** Smoothed GPU ms per frame, or -1 until a result arrives. */
  ms = -1;
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: TimerQueryExt | null;
  private readonly pool: WebGLQuery[] = [];
  private readonly inFlight: (WebGLQuery | null)[] = [null, null, null, null];
  private head = 0;
  private count = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const ext: unknown = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.ext = isTimerExt(ext) ? ext : null;
  }

  /** Whether the extension exists. */
  get available(): boolean {
    return this.ext !== null;
  }

  /** Starts timing a frame. Returns false (and times nothing) when unavailable or too many results are pending. */
  begin(): boolean {
    const ext = this.ext;
    if (ext === null || this.count >= MAX_IN_FLIGHT) return false;
    const q = this.pool.pop() ?? this.gl.createQuery();
    this.gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    this.inFlight[(this.head + this.count) % MAX_IN_FLIGHT] = q;
    this.count++;
    return true;
  }

  end(): void {
    if (this.ext !== null) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
  }

  /** Harvests finished queries in order; a disjoint event discards them. */
  poll(): void {
    const gl = this.gl;
    const ext = this.ext;
    if (ext === null) return;
    while (this.count > 0) {
      const q = this.inFlight[this.head];
      if (q === null || q === undefined) break;
      const available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) === true;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) === true;
      if (!available && !disjoint) break;
      if (available && !disjoint) {
        const ms = Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6;
        this.ms = this.ms < 0 ? ms : this.ms + (ms - this.ms) * 0.1;
      }
      this.inFlight[this.head] = null;
      this.pool.push(q);
      this.head = (this.head + 1) % MAX_IN_FLIGHT;
      this.count--;
    }
  }

  /** Forgets the average, as when it measured a tier no longer in use; queries in flight still land. */
  reset(): void {
    this.ms = -1;
  }

  dispose(): void {
    for (const q of this.pool) this.gl.deleteQuery(q);
    for (const q of this.inFlight) if (q !== null && q !== undefined) this.gl.deleteQuery(q);
    this.pool.length = 0;
    this.inFlight.fill(null);
    this.count = 0;
  }
}

function isTimerExt(ext: unknown): ext is TimerQueryExt {
  return (
    typeof ext === "object" &&
    ext !== null &&
    "TIME_ELAPSED_EXT" in ext &&
    "GPU_DISJOINT_EXT" in ext
  );
}

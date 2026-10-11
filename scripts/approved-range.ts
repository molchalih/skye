// Which commits scripts/check-approved.ts checks, given the base CI passes: the pull request's base, or the previous
// head of a push (`github.event.before`). That base can be unusable: all zeros on a branch's first push, empty on a
// manual run, gone after a force-push (CI fetches only reachable history), or still known but off HEAD's history
// when the branch was rewritten and the old head is still around. None of these is a fault of the commits pushed.
import { spawnSync } from "node:child_process";

export const APPROVED_FILES: readonly string[] = [
  "test/reference/skye-approved.js",
  "test/reference/skye-approved.d.ts",
];

/** The few facts about the repository the choice needs, so it can be tested against any history. */
export interface Git {
  /** The full SHA of `rev` if it names a commit here, otherwise undefined. */
  commit(rev: string): string | undefined;
  isAncestor(ancestor: string, of: string): boolean;
  mergeBase(a: string, b: string): string | undefined;
  /** Commits in `range` (`git log` syntax) that change the approved build, newest first. */
  approvals(range: readonly string[]): string[];
}

export interface Checked {
  commits: string[];
  /** What was checked, in words, for the CI log. */
  scope: string;
}

export function approvalsToCheck(given: string, git: Git): Checked {
  // CI only ever passes a SHA. A name (HEAD, @, main~0) is a caller's mistake, not lost history: it could resolve to
  // HEAD itself and check nothing, so it fails loudly rather than being quietly replaced by a fallback.
  if (!/^(?:[0-9a-f]{4,40})?$/i.test(given))
    throw new Error(
      `check-approved: the base must be a commit SHA, empty or all zeros, not ${JSON.stringify(given)}`,
    );
  const none = /^0*$/.test(given);
  const base = none ? undefined : git.commit(given);
  if (base !== undefined && git.isAncestor(base, "HEAD"))
    return { commits: git.approvals([`${base}..HEAD`]), scope: `${short(base)}..HEAD` };
  // A rewritten branch whose old head is still known: everything since the two histories parted is new to CI.
  const parted = base === undefined ? undefined : git.mergeBase(base, "HEAD");
  if (base !== undefined && parted !== undefined)
    return {
      commits: git.approvals([`${parted}..HEAD`]),
      scope: `${short(parted)}..HEAD (${short(base)} is not on HEAD's history; checked since they parted)`,
    };
  // Otherwise which commits are new is unknowable, but the approval whose provenance matters is the one in force,
  // HEAD's last commit to change the approved build: the gate draws only that one, so any earlier one is superseded.
  const reason = none
    ? "no base given"
    : base === undefined
      ? `base ${given} is not a commit here`
      : `base ${short(base)} shares no history with HEAD`;
  return { commits: git.approvals(["-1", "HEAD"]), scope: `the approval in force (${reason})` };
}

function short(sha: string): string {
  return sha.slice(0, 12);
}

export function gitAt(cwd: string): Git {
  const git = (args: readonly string[]) =>
    spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = (args: readonly string[]): string => {
    const r = git(args);
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed:\n${r.stdout}${r.stderr}`);
    return r.stdout;
  };
  return {
    commit(rev) {
      const r = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
      return r.status === 0 ? r.stdout.trim() : undefined;
    },
    isAncestor(ancestor, of) {
      const r = git(["merge-base", "--is-ancestor", ancestor, of]);
      if (r.status === 0 || r.status === 1) return r.status === 0;
      throw new Error(`git merge-base --is-ancestor failed:\n${r.stderr}`);
    },
    mergeBase(a, b) {
      const r = git(["merge-base", a, b]);
      return r.status === 0 ? r.stdout.trim() : undefined;
    },
    approvals(range) {
      return out(["log", "--format=%H", ...range, "--", ...APPROVED_FILES])
        .split("\n")
        .filter((c) => c !== "");
    },
  };
}

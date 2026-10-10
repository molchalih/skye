import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvalsToCheck, gitAt } from "./approved-range.ts";

// A small history: an approval, a plain commit, then a branch that was rewritten. The old head still exists; the
// rewritten one makes two approvals of its own.
//   c0 - a1 - c2 - old           (force-pushed away)
//               \- a3 - a4       HEAD
let dir = "";
const at: Record<string, string> = {};

function git(...args: string[]): string {
  const r = spawnSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(name: string, file: string): void {
  writeFileSync(join(dir, file), name);
  git("add", "-A");
  git("commit", "-q", "-m", name);
  at[name] = git("rev-parse", "HEAD");
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "skye-approved-range-"));
  mkdirSync(join(dir, "test/reference"), { recursive: true });
  git("init", "-q");
  commit("c0", "readme");
  commit("a1", "test/reference/skye-approved.js");
  commit("c2", "readme");
  commit("old", "test/reference/skye-approved.d.ts");
  git("reset", "-q", "--hard", at["c2"] ?? "");
  commit("a3", "test/reference/skye-approved.js");
  commit("a4", "test/reference/skye-approved.d.ts");
  // A root commit of its own, sharing no history with HEAD.
  at["stray"] = git("commit-tree", "-m", "stray", `${sha("c0")}^{tree}`);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sha = (name: string): string => at[name] ?? "";

describe("approvalsToCheck", () => {
  it("checks every approval after a base on HEAD's history, as for any push or pull request", () => {
    expect(approvalsToCheck(sha("a1"), gitAt(dir))).toEqual({
      commits: [sha("a4"), sha("a3")],
      scope: `${sha("a1").slice(0, 12)}..HEAD`,
    });
    expect(approvalsToCheck(sha("a3").slice(0, 7), gitAt(dir)).commits).toEqual([sha("a4")]);
    expect(approvalsToCheck(sha("a4"), gitAt(dir)).commits).toEqual([]);
  });

  it("checks since the histories parted when the base is a known commit off HEAD's history", () => {
    const checked = approvalsToCheck(sha("old"), gitAt(dir));
    expect(checked.commits).toEqual([sha("a4"), sha("a3")]);
    expect(checked.scope).toMatch(new RegExp(`^${sha("c2").slice(0, 12)}\\.\\.HEAD \\(`));
  });

  it("checks the approval in force when the base is gone", () => {
    const checked = approvalsToCheck("0123456789abcdef0123456789abcdef01234567", gitAt(dir));
    expect(checked.commits).toEqual([sha("a4")]);
    expect(checked.scope).toContain("is not a commit here");
  });

  it("checks the approval in force when the base shares no history with HEAD", () => {
    const checked = approvalsToCheck(sha("stray"), gitAt(dir));
    expect(checked.commits).toEqual([sha("a4")]);
    expect(checked.scope).toContain("shares no history with HEAD");
  });

  it("refuses a base that is not a SHA, rather than check a range it may have emptied", () => {
    for (const given of ["HEAD", "@", "main~0", "--all", "a4", `${sha("a1")}0`])
      expect(() => approvalsToCheck(given, gitAt(dir))).toThrow(/must be a commit SHA/);
  });

  it("checks the approval in force when there is no base", () => {
    for (const given of ["0000000000000000000000000000000000000000", ""])
      expect(approvalsToCheck(given, gitAt(dir))).toEqual({
        commits: [sha("a4")],
        scope: "the approval in force (no base given)",
      });
  });
});

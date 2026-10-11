// The approved build's tripwire: `bun scripts/check-approved.ts <base>`, where `base` is a commit SHA, empty or all
// zeros. Each checked commit that changes test/reference/skye-approved.* must hold exactly what `bun run look:approve`
// bundles from that commit's own source. Which commits are checked (scripts/approved-range.ts):
// - every commit after `base`, when `base` is on HEAD's history (a normal push or pull request);
// - every commit since `base` and HEAD parted, when `base` exists off HEAD's history (a rewritten branch);
// - the approval in force, HEAD's last commit to change the build, when there is no base, it is gone after a
//   force-push, or it shares no history with HEAD. The log names the range checked.
// A commit that leaves the files alone passes: the approved build then pins an earlier look, which is its purpose.
// So an approval can carry neither a hand-edited bundle nor one built from other source than the change it approves;
// whether the look it records is right is for the owner's review (.github/CODEOWNERS) and the frozen baseline.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_FILES as FILES, approvalsToCheck, gitAt } from "./approved-range.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function run(cmd: string, args: readonly string[], cwd: string): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stdout}${r.stderr}`);
  return r.stdout;
}

const { commits, scope } = approvalsToCheck(process.argv[2] ?? "", gitAt(ROOT));
process.stdout.write(`checking ${scope}\n`);

for (const commit of commits) {
  const dir = mkdtempSync(join(tmpdir(), "skye-check-approved-"));
  try {
    run("git", ["worktree", "add", "--detach", dir, commit], ROOT);
    // The dependencies installed for HEAD; a commit that changed them may bundle differently, and then fails here.
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
    run(process.execPath, ["scripts/approve-look.ts"], dir);
    const changed = run("git", ["status", "--porcelain", "--", ...FILES], dir);
    if (changed !== "")
      throw new Error(
        `${commit.slice(0, 12)} changes the approved build, but its source bundles to something else:\n${changed}` +
          "Run `bun run look:approve` in that commit, after the owner's approval (CONTRIBUTING.md).",
      );
    process.stdout.write(`${commit.slice(0, 12)}: the approved build is its own source, bundled\n`);
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: ROOT });
    rmSync(dir, { recursive: true, force: true });
  }
}
if (commits.length === 0)
  process.stdout.write("none of these commits changes the approved build\n");

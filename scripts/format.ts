import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (mode !== "--check" && mode !== "--write") {
  throw new Error("usage: bun scripts/format.ts --check|--write");
}

const root = fileURLToPath(new URL("..", import.meta.url));

// Asking git, not the filesystem, keeps untracked tooling directories listed in
// .git/info/exclude out of the run while still covering new files.
const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (listed.error) throw listed.error;
if (listed.status !== 0) {
  throw new Error(`git ls-files failed: ${listed.stderr}`);
}

// A tracked file deleted from the worktree is still listed; prettier rejects it.
const files = listed.stdout
  .split("\0")
  .filter((file) => file !== "" && existsSync(join(root, file)));

const prettier = fileURLToPath(
  new URL("../node_modules/prettier/bin/prettier.cjs", import.meta.url),
);
const chunk = 200;
let failed = false;
for (let i = 0; i < files.length; i += chunk) {
  const run = spawnSync(
    process.execPath,
    [prettier, "--ignore-unknown", mode, ...files.slice(i, i + chunk)],
    { cwd: root, stdio: "inherit" },
  );
  if (run.error) throw run.error;
  if (run.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;

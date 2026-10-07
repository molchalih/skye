import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { INSTALLED, REPO, SCRATCH } from "./paths.ts";

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

/**
 * Packs skye the way it is published (`prepack` builds it first) and unpacks the tarball where the consumers
 * resolve `@a240/skye`, so every consumer test sees the published files and nothing else of the repository.
 */
export function setup(): void {
  const packs = join(SCRATCH, "pack");
  rmSync(packs, { recursive: true, force: true });
  mkdirSync(packs, { recursive: true });
  run("bun", ["pm", "pack", "--quiet", "--destination", packs], REPO);
  const tarball = readdirSync(packs).find((file) => file.endsWith(".tgz"));
  if (tarball === undefined) throw new Error("bun pm pack wrote no tarball");
  rmSync(INSTALLED, { recursive: true, force: true });
  mkdirSync(INSTALLED, { recursive: true });
  run("tar", ["-xzf", join(packs, tarball), "-C", INSTALLED, "--strip-components=1"], REPO);
}

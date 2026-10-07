import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CONSUMERS, REPO } from "./paths.ts";

function typecheck(project: string): void {
  const tsc = join(REPO, "node_modules", ".bin", "tsc");
  const result = spawnSync(tsc, ["-p", join(CONSUMERS, project, "tsconfig.json")], {
    encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  expect(result.stdout + result.stderr).toBe("");
  expect(result.status).toBe(0);
}

// The fixture uses every entry point as a TypeScript user would, including the declarations skye adds to
// HTMLElementTagNameMap and to React's JSX namespace, and checks the shipped .d.ts files themselves (no skipLibCheck).
test("the shipped declarations type-check a consumer", () => {
  typecheck("types");
});

// A program of its own: in the one above, `@a240/skye/element` already declares the tag for every file.
test("importing @a240/skye/define alone types <skye-view> as SkyeElement", () => {
  typecheck("types/define");
});

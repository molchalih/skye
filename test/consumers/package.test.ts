import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import type * as Core from "../../src/index.ts";
import type * as Element from "../../src/element/index.ts";
import { INSTALLED, REPO } from "./paths.ts";

// In whatever quotes and spacing the minifier prints: bundlers match the pattern, not the spelling.
const WORKER_URL = /new URL\((["'`])\.\/worker\.js\1,\s*import\.meta\.url\)/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(INSTALLED, join(entry.parentPath, entry.name)))
    .sort();
}

interface PackageJson {
  dependencies?: Record<string, string>;
  engines?: Record<string, string>;
  exports: Record<string, string | Record<string, string>>;
  customElements: string;
  sideEffects: string[];
}

const pkg: PackageJson = JSON.parse(readFileSync(join(INSTALLED, "package.json"), "utf8"));

async function load<T>(file: string): Promise<T> {
  // The packed modules, not the source: what a user's import resolves to.
  const module: T = await import(pathToFileURL(join(INSTALLED, file)).href);
  return module;
}

describe("the packed package", () => {
  test("ships only the build, its source maps, the manifest, the readme and the licence", () => {
    const other = files(INSTALLED).filter(
      (file) =>
        !/^dist\/[\w-]+\.(js|js\.map|d\.ts)$/.test(file) &&
        !["package.json", "README.md", "LICENSE", "custom-elements.json"].includes(file),
    );
    expect(other).toEqual([]);
  });

  // Each script's map is beside it and carries the sources, which the package does not ship otherwise.
  test("maps every script to its sources", () => {
    const scripts = files(join(INSTALLED, "dist")).filter((file) => file.endsWith(".js"));
    for (const script of scripts) {
      const code = readFileSync(join(INSTALLED, script), "utf8");
      const named = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(code)?.[1];
      // A re-export with no code of its own has nothing to map.
      if (named === undefined) continue;
      const map: { sources: string[]; sourcesContent?: (string | null)[] } = JSON.parse(
        readFileSync(join(INSTALLED, dirname(script), named), "utf8"),
      );
      expect(map.sourcesContent?.length, script).toBe(map.sources.length);
      expect(map.sourcesContent?.every((content) => typeof content === "string")).toBe(true);
    }
  });

  // A bundler drops a side-effect-free import entirely: `import "@a240/skye/worker"` in a custom worker would be empty.
  test("declares the side-effect entries", () => {
    expect(pkg.sideEffects).toEqual(["./dist/define.js", "./dist/worker.js"]);
  });

  test("the worker entry does nothing outside a worker", async () => {
    await expect(load("dist/worker.js")).resolves.toBeDefined();
  });

  test("has no runtime dependencies and pins no engine on its users", () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.engines).toBeUndefined();
  });

  test("every export target is in the package", () => {
    const targets = Object.values(pkg.exports).flatMap((target) =>
      typeof target === "string" ? [target] : Object.values(target),
    );
    for (const target of targets) expect(existsSync(join(INSTALLED, target)), target).toBe(true);
    for (const path of pkg.sideEffects) expect(existsSync(join(INSTALLED, path)), path).toBe(true);
  });

  // Bundlers and browsers resolve the worker relative to the chunk that names it, so they must sit side by side.
  test("the worker entry sits beside every chunk that loads it", () => {
    const dist = join(INSTALLED, "dist");
    const spawners = files(dist).filter(
      (file) =>
        file.endsWith(".js") && WORKER_URL.test(readFileSync(join(INSTALLED, file), "utf8")),
    );
    expect(spawners).not.toEqual([]);
    for (const file of spawners) {
      expect(join(dirname(file), "worker.js")).toBe("dist/worker.js");
    }
    expect(pkg.exports["./worker"]).toEqual({
      types: "./dist/worker.d.ts",
      default: "./dist/worker.js",
    });
  });
});

describe("the custom elements manifest", () => {
  interface Attribute {
    name: string;
    default?: string;
  }
  interface Declaration {
    name: string;
    customElement?: boolean;
    tagName?: string;
    attributes?: Attribute[];
    events?: { name: string; type?: { text: string } }[];
    members?: { kind: string; name: string }[];
  }
  interface Manifest {
    modules: {
      path: string;
      declarations: Declaration[];
      exports: { kind: string; name: string; declaration: { name: string; module: string } }[];
    }[];
  }

  const manifest: Manifest = JSON.parse(readFileSync(join(INSTALLED, pkg.customElements), "utf8"));
  const element = manifest.modules
    .flatMap((module) => module.declarations)
    .find((declaration) => declaration.customElement === true);

  test("describes <skye-view> where it is published", () => {
    expect(element?.name).toBe("SkyeElement");
    expect(element?.tagName).toBe("skye-view");
    for (const module of manifest.modules)
      expect(existsSync(join(INSTALLED, module.path))).toBe(true);
    const definitions = manifest.modules.flatMap((module) =>
      module.exports
        .filter((entry) => entry.kind === "custom-element-definition")
        .map((entry) => [module.path, entry.name, entry.declaration.module]),
    );
    expect(definitions).toEqual([["dist/define.js", "skye-view", "dist/element.js"]]);
    expect(
      element?.members?.filter((member) => member.kind === "method").map((m) => m.name),
    ).toEqual(["stats"]);
  });

  test("lists every attribute, with defaults the element really applies", async () => {
    const { SKYE_ATTRIBUTES, attributesToParams } = await load<typeof Element>("dist/element.js");
    const { DEFAULTS, resolveParams } = await load<typeof Core>("dist/index.js");
    const attributes = element?.attributes ?? [];
    expect(attributes.map((attribute) => attribute.name)).toEqual(SKYE_ATTRIBUTES);
    // Every attribute set to its documented default gives the default params, and so does none at all.
    const documented = new Map(attributes.map((attribute) => [attribute.name, attribute.default]));
    const params = attributesToParams((name) => documented.get(name) ?? null);
    expect(resolveParams(params)).toEqual(DEFAULTS);
    expect(Object.entries(params).filter(([, value]) => value === undefined)).toEqual([
      ["wind", undefined],
    ]);
  });

  test("lists every event", async () => {
    const events = await load<typeof Element>("dist/element.js");
    expect(element?.events?.map((event) => event.name)).toEqual([
      events.SKYE_READY,
      events.SKYE_ERROR,
      events.SKYE_CONTEXTLOST,
      events.SKYE_CONTEXTRESTORED,
      events.SKYE_FALLBACK,
      events.SKYE_TIERCHANGE,
    ]);
  });

  // The manifest's types come from the element's JSDoc; the source's own map of event details is the truth.
  test("gives each event the detail type SkyeEventDetailMap declares", () => {
    const source = readFileSync(join(REPO, "src", "element", "element.ts"), "utf8");
    const map = /interface SkyeEventDetailMap \{([^}]*)\}/.exec(source)?.[1] ?? "";
    const declared = [...map.matchAll(/"([\w-]+)": ([^;]+);/g)].map(([, name, detail]) => [
      name,
      `CustomEvent<${detail}>`,
    ]);
    expect(declared).toHaveLength(6);
    expect(element?.events?.map((event) => [event.name, event.type?.text])).toEqual(declared);
  });
});

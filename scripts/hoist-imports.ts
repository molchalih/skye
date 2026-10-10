import type { Rolldown } from "tsdown";

/** What hoisting reads and writes of an output file: a chunk, or an asset, which it skips. */
export type OutputFile =
  { type: "chunk"; isEntry: boolean; imports: readonly string[]; code: string } | { type: "asset" };

const SOURCE_MAP_COMMENT = "\n//# sourceMappingURL=";

/**
 * Adds to each entry chunk a bare import of every chunk it needs only
 * through other chunks, so a browser loading `dist/` as published (from a
 * CDN, or any host without a bundler) requests all of them at once. A browser
 * finds a module's imports only once it has that module, so each link of a
 * chain costs a request round: `define.js`, its element chunk, the renderer,
 * then the astro chunk took four. Rollup's `hoistTransitiveImports` does this;
 * Rolldown has no such option.
 *
 * The imports go at the end of the entry, after the ones it has, so modules
 * evaluate in the order they did, and before its source map comment, so
 * every mapping still points where it did. A bundler sees only modules
 * already in its graph. External imports (`react`) are left alone.
 */
export function hoistImports(bundle: Readonly<Record<string, OutputFile>>): void {
  for (const [own, entry] of Object.entries(bundle)) {
    if (entry.type !== "chunk" || !entry.isEntry) continue;
    const reached = new Set(entry.imports);
    // A Set visits what is added while it is iterated, so this walks the whole graph.
    for (const file of reached) {
      const chunk = bundle[file];
      if (chunk?.type === "chunk") for (const deeper of chunk.imports) reached.add(deeper);
    }
    const hoisted = [...reached]
      // A chunk may import the entry itself (one entry importing another), which must not import itself.
      .filter(
        (file) => file !== own && !entry.imports.includes(file) && bundle[file]?.type === "chunk",
      )
      .map((file) => `import"./${file}";`)
      .join("");
    if (hoisted === "") continue;
    const comment = entry.code.lastIndexOf(SOURCE_MAP_COMMENT);
    const end = comment === -1 ? entry.code.length : comment;
    entry.code = `${entry.code.slice(0, end)}\n${hoisted}${entry.code.slice(end)}`;
  }
}

/** `hoistImports` as a build plugin. */
export const hoistTransitiveImports: Rolldown.Plugin = {
  name: "skye:hoist-transitive-imports",
  generateBundle(_options, bundle) {
    hoistImports(bundle);
  },
};

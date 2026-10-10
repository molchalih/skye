import { describe, expect, it } from "vitest";
import { hoistImports, type OutputFile } from "./hoist-imports.ts";

function chunk(code: string, imports: string[], isEntry = false): OutputFile {
  return { type: "chunk", isEntry, imports, code };
}

function textOf(file: OutputFile | undefined): string {
  return file?.type === "chunk" ? file.code : "";
}

describe("hoistImports", () => {
  it("adds every deeper chunk to an entry, after its own imports and before its source map comment", () => {
    const bundle: Record<string, OutputFile> = {
      "define.js": chunk(
        'import{n as e}from"./define-a.js";e();\n//# sourceMappingURL=define.js.map',
        ["define-a.js"],
        true,
      ),
      "define-a.js": chunk("…", ["renderer-b.js", "protocol-c.js"]),
      "renderer-b.js": chunk("…", ["astro-d.js"]),
      "protocol-c.js": chunk("…", []),
      "astro-d.js": chunk("…", []),
      "define.js.map": { type: "asset" },
    };
    hoistImports(bundle);
    expect(textOf(bundle["define.js"])).toBe(
      'import{n as e}from"./define-a.js";e();\n' +
        'import"./renderer-b.js";import"./protocol-c.js";import"./astro-d.js";\n' +
        "//# sourceMappingURL=define.js.map",
    );
    // Shared chunks are not entries: their own imports already load in parallel with them.
    expect(textOf(bundle["define-a.js"])).toBe("…");
  });

  it("appends to an entry without a source map, and leaves entries with nothing deeper and externals alone", () => {
    const bundle: Record<string, OutputFile> = {
      "index.js": chunk('export{a}from"./renderer-b.js";', ["renderer-b.js"], true),
      "react.js": chunk('import"./define-a.js";import"react";', ["define-a.js", "react"], true),
      "astro.js": chunk('export{a}from"./astro-d.js";', ["astro-d.js"], true),
      "define-a.js": chunk("…", ["renderer-b.js"]),
      "renderer-b.js": chunk("…", ["astro-d.js"]),
      "astro-d.js": chunk("…", []),
    };
    hoistImports(bundle);
    expect(textOf(bundle["index.js"])).toBe(
      'export{a}from"./renderer-b.js";\nimport"./astro-d.js";',
    );
    expect(textOf(bundle["react.js"])).toBe(
      'import"./define-a.js";import"react";\nimport"./renderer-b.js";import"./astro-d.js";',
    );
    expect(textOf(bundle["astro.js"])).toBe('export{a}from"./astro-d.js";');
  });

  it("never makes an entry import itself through a chunk that imports it", () => {
    const bundle: Record<string, OutputFile> = {
      "a.js": chunk('import"./shared-b.js";', ["shared-b.js"], true),
      "shared-b.js": chunk('import"./a.js";import"./c.js";', ["a.js", "c.js"]),
      "c.js": chunk("…", []),
    };
    hoistImports(bundle);
    expect(textOf(bundle["a.js"])).toBe('import"./shared-b.js";\nimport"./c.js";');
  });
});

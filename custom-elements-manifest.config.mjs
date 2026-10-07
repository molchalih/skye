// The manifest describes `<skye-view>` for editors and catalogues. The element's JSDoc supplies what the analyzer
// cannot infer from the source: the tag (defined through `defineSkye`), the attributes and the events.

const ELEMENT = "dist/element.js";
const DEFINE = "dist/define.js";

// What the analyzer misreads from the source as members of the element: assignments to other objects in the
// constructor (the shadow root's style sheets, the gradient's background) and the type parameter of the event
// dispatch helper.
const MISREAD_MEMBERS = new Set(["adoptedStyleSheets", "background"]);
const MISREAD_EVENTS = new Set(["type"]);
// HTMLElement's own methods, overridden only to type the element's events.
const INHERITED_MEMBERS = new Set(["addEventListener", "removeEventListener"]);

/** Throws on public API whose description is absent or blank: the manifest would publish it undocumented. */
function documented(kind, entries) {
  for (const entry of entries) {
    if (typeof entry.description !== "string" || entry.description.trim() === "") {
      throw new Error(
        `skye-view ${kind} "${entry.name}" has no description; document it in the source`,
      );
    }
  }
  return entries;
}

/**
 * Reshapes the analysis of the source into the published surface: the declarations `skye/element` exports, at the
 * path they are published under, and the definition `skye/define` makes. Internal modules, private members,
 * inherited methods and the analyzer's misreadings are left out; any other undocumented member or event fails.
 */
function publishedSurface() {
  return {
    name: "skye-published-surface",
    packageLinkPhase({ customElementsManifest: manifest }) {
      const index = manifest.modules.find((module) => module.path === "src/element/index.ts");
      if (index === undefined) throw new Error("src/element/index.ts was not analyzed");
      const exported = new Set(index.exports.map((entry) => entry.name));
      const declarations = manifest.modules
        .flatMap((module) => module.declarations ?? [])
        .filter((declaration) => exported.has(declaration.name));
      for (const declaration of declarations) {
        if (!declaration.customElement) continue;
        declaration.superclass = { name: "HTMLElement", package: "global:" };
        declaration.members = documented(
          "member",
          declaration.members.filter(
            (member) =>
              member.privacy === undefined &&
              !MISREAD_MEMBERS.has(member.name) &&
              !INHERITED_MEMBERS.has(member.name),
          ),
        );
        declaration.events = documented(
          "event",
          declaration.events.filter((event) => !MISREAD_EVENTS.has(event.name)),
        );
      }
      const element = declarations.find((declaration) => declaration.customElement);
      if (element === undefined) throw new Error("no custom element among the exports");
      manifest.modules = [
        {
          kind: "javascript-module",
          path: ELEMENT,
          declarations,
          exports: declarations.map(({ name }) => ({
            kind: "js",
            name,
            declaration: { name, module: ELEMENT },
          })),
        },
        {
          kind: "javascript-module",
          path: DEFINE,
          declarations: [],
          exports: [
            {
              kind: "custom-element-definition",
              name: element.tagName,
              declaration: { name: element.name, module: ELEMENT },
            },
          ],
        },
      ];
    },
  };
}

export default {
  globs: ["src/element/*.ts"],
  exclude: ["src/**/*.test.ts"],
  outdir: ".",
  // package.json names the manifest itself; the analyzer would otherwise rewrite the file on every build.
  packagejson: false,
  plugins: [publishedSurface()],
};

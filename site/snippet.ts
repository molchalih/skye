// The markup for the sky on screen, live: the attributes that differ from skye's defaults.
import type { ResolvedParams } from "../src/index.ts";
import { $, copy } from "./dom.ts";
import { shown } from "./sky.ts";
import { essentialAttributes } from "./state.ts";

export interface Snippet {
  render(p: ResolvedParams): void;
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  return el;
}

function tag(p: ResolvedParams): string {
  const attributes = essentialAttributes(shown(p))
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");
  return `<skye-view${attributes}></skye-view>`;
}

export function createSnippet(get: () => ResolvedParams): Snippet {
  const code = $("#code");
  let last = "";

  // The Copy button carries the published URL of skye to paste, which the build writes into the page.
  const copyHtml = $("#copy-html", document, HTMLButtonElement);
  copyHtml.addEventListener("click", () => {
    const html = [
      `<script type="module" src="${copyHtml.dataset.cdn ?? ""}"></script>`,
      "",
      `<div style="position: relative; height: 480px">`,
      `  ${tag(get())}`,
      `</div>`,
      "",
    ].join("\n");
    void copy(copyHtml, html, { fallback: code });
  });

  return {
    render(p) {
      const text = tag(p);
      if (text === last) return;
      last = text;
      const parts = [span("t", "<skye-view")];
      for (const [name, value] of essentialAttributes(shown(p))) {
        parts.push(span("a", ` ${name}=`), span("v", `"${value}"`));
      }
      parts.push(span("t", "></skye-view>"));
      code.replaceChildren(...parts);
    },
  };
}

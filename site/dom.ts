// Small DOM helpers the page's modules share.

interface ElementClass<T extends Element> {
  new (): T;
  readonly prototype: T;
}

/**
 * The element matching `selector` under `root`. Throws when it is missing or of
 * another kind, so a renamed id fails loudly at start rather than quietly later.
 */
export function $(selector: string, root?: ParentNode): HTMLElement;
export function $<T extends Element>(selector: string, root: ParentNode, type: ElementClass<T>): T;
export function $(
  selector: string,
  root: ParentNode = document,
  type: ElementClass<Element> = HTMLElement,
): Element {
  const el = root.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`expected ${selector} to be ${type.name}`);
  return el;
}

const resets = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>();
const labels = new WeakMap<HTMLButtonElement, string>();

export interface CopyOptions {
  /** Selected where the clipboard is refused, so the viewer can copy it themselves. */
  fallback?: Element | undefined;
  /** What the button says once the text is on the clipboard; "Copied" by default. */
  done?: string | undefined;
}

/** Writes `text` to the clipboard and says so on `button` for a moment. */
export async function copy(
  button: HTMLButtonElement,
  text: string,
  { fallback, done = "Copied" }: CopyOptions = {},
): Promise<void> {
  const label = labels.get(button) ?? button.textContent.trim();
  labels.set(button, label);
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = done;
  } catch {
    const selection = getSelection();
    if (fallback !== undefined && selection !== null) {
      const range = document.createRange();
      range.selectNodeContents(fallback);
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = "Selected";
    } else {
      button.textContent = "Couldn’t copy";
    }
  }
  clearTimeout(resets.get(button));
  resets.set(
    button,
    setTimeout(() => (button.textContent = label), 1600),
  );
}

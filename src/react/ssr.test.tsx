import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Skye } from "./index.tsx";

describe("server rendering", () => {
  it("renders the bare tag with attributes and no DOM", () => {
    expect(typeof document).toBe("undefined");
    const html = renderToString(
      <Skye scene="storm" dayOfYear={10} glass worker className="sky" onReady={() => undefined} />,
    );
    expect(html).toContain("<skye-view");
    expect(html).toContain('scene="storm"');
    expect(html).toContain('day-of-year="10"');
    expect(html).toContain('glass="1"');
    expect(html).toContain('worker=""');
    expect(html).toContain('class="sky"');
    expect(html).not.toContain("onReady");
  });
});

import { expect, it } from "vitest";

it("offers a WebGL2 context in this engine", () => {
  const gl = document.createElement("canvas").getContext("webgl2");
  expect(gl).not.toBeNull();
});

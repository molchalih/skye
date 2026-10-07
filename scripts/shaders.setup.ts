import { writeShaders } from "./shaders.ts";

// Runs before every test run, focused ones included, so tests never import shaders older than the .glsl files.
export function setup(): void {
  writeShaders();
}

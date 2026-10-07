import { fileURLToPath } from "node:url";

/** The repository root, where skye is packed from. */
export const REPO: string = fileURLToPath(new URL("../..", import.meta.url));

/** The consumers' own package root. */
export const CONSUMERS: string = fileURLToPath(new URL(".", import.meta.url));

/** Where the packed tarball is unpacked: what `npm install` of the tarball would produce. */
export const INSTALLED: string = fileURLToPath(
  new URL("./node_modules/@a240/skye/", import.meta.url),
);

/** Scratch space for the tarball and build output. */
export const SCRATCH: string = fileURLToPath(
  new URL("../../node_modules/.cache/skye-consumers/", import.meta.url),
);

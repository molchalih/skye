// A program that imports nothing of skye but the side-effect entry, as a script-tag or CDN user's TypeScript would.
import "skye/define";

const found = document.querySelector("skye-view");
const stats: { worker: boolean } | null | undefined = found?.stats();

export { stats };

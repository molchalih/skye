# skye

A zero-dependency WebGL2 sky renderer.

Status: work in progress, not yet published.

Size: the core entry is above the v6 baseline of 14136 B (esbuild 0.28.2 `--minify`, then brotli quality 11); `docs/tradeoffs.md` records why and by how much. `bun run size` holds each entry at its recorded limit, measured with size-limit's own minifier and brotli quality 11, with v6 measured the same way beside it.

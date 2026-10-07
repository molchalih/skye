# skye

A zero-dependency WebGL2 sky renderer.

Status: work in progress, not yet published.

Size budget: the core entry must stay within the v6 baseline of 14136 B (esbuild 0.28.2 `--minify`, 42804 B, then brotli quality 11; `bun build --minify` gives 44785 B and 14141 B). The `.size-limit.json` path is filled in when the build exists.

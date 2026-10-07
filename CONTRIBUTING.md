# Contributing

## Setup

You need [Bun](https://bun.sh) 1.4.2 (the version in `packageManager`).

```sh
bun install
bunx playwright install webkit chromium firefox
```

The tests run in real browsers through Playwright, so all three engines must be installed.

## Checks

`bun run check` is the gate. It runs `check:static`, then `check:browsers`, each step in this order:

| Step             | What it checks                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `lint`           | oxlint with type-aware rules, after generating the shaders                                                         |
| `typecheck`      | `tsc -b`, strict, over `src`, `scripts`, `test` and `bench`                                                        |
| `format:check`   | prettier (`bun run format` fixes it)                                                                               |
| `test:unit`      | unit tests in Node                                                                                                 |
| `build`          | shader generation, tsdown (minified, with source maps), and the custom elements manifest                           |
| `check:package`  | publint (strict) and Are the Types Wrong? (ESM-only profile)                                                       |
| `size`           | each entry against its limit in `.size-limit.json`                                                                 |
| `test:browser`   | browser tests in WebKit, Chromium and Firefox, then the worker tests; includes the pixel parity gate               |
| `test:consumers` | the packed package from plain HTML with an import map, from a Vite app, from type-checked consumers, and beside v6 |

While you work, run the part you need: `bun run test:unit`, `bun run test:browser`, `bun run test:consumers`.

`bun run bench` opens a benchmark page, a manual tool that `check` does not run. The stage defaults to 1280×960 CSS px; change it with `?w=` and `?h=`. The page prints a Markdown table (Tier, Mode, Scene, GPU ms, CPU ms, fps, Mpx, Method, Status) to paste into docs. In main-thread mode it drives the core with GPU timing on, so every tier has a GPU time; worker mode drives `<skye-view>`, which times the GPU only under `quality="auto"`.

## Pixel parity

skye draws exactly what the renderer it replaces (v6) draws. v6's source is kept unchanged in `test/reference/weather-sky-v6.js`, and the parity gate renders both side by side.

- **When a parity case fails, fix the divergence in skye.** Never edit the reference file and never loosen the tolerance.
- **A change that could alter pixels does not go into code.** Propose it in an issue with its measured gain and parity diff. It is applied only after the owner approves that item. This covers fewer particles, fewer ray taps, lower precision, skipped mipmaps, lower octave caps and any shader change beyond stripping comments and whitespace.
- **No default may read the clock or the calendar.** Callers pass time and date.
- **Per-frame code allocates nothing.**

## Commits

Conventional commits:

```
type(scope): description
```

- `type` is one of `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`. A change that fits none of them is usually two changes.
- The description is lowercase, imperative, has no trailing period, and keeps the subject under 72 characters: `feat(element): add the worker attribute`.
- The body is empty. Reasoning belongs in a code comment, in the docs, or in the pull request.
- One logical change per commit. A commit that only fixes the previous one is amended into it before pushing.

## Releases

`changeset status` compares against the `main` branch, so that branch must exist.

Releases use [Changesets](https://github.com/changesets/changesets).

1. A change that users can see adds a changeset with `bun run changeset`. Pick the bump (`patch`, `minor` or `major`) and describe the change for a reader of the changelog. Commit the generated file in `.changeset/` with the change.
2. To release, run `bun run version-packages`. It bumps `package.json`, writes `CHANGELOG.md` and removes the consumed changesets. Commit the result.
3. Publish from CI, not by hand (the first publish below is the one exception). `prepack` rebuilds `dist/` first.

While the version is below 1.0.0, a breaking change is a `minor` bump.

### First release

One-time setup, done by the owner:

1. Make the GitHub repository public; npm provenance requires a public source repository.
2. Create the `npm` environment in the repository settings (protect it as needed).
3. Publish 0.1.0 by hand, since npm needs the package to exist before a trusted publisher can be added (no provenance for this one):
   1. `bunx changeset version` bumps `package.json` to 0.1.0 and writes `CHANGELOG.md`, offline.
   2. Review, commit and push the result.
   3. `bun run check`.
   4. `npm login`, then `npm publish` from that commit (`publishConfig` makes it public; `prepack` rebuilds `dist/`).
4. On npmjs.com, add the `release` workflow as the package's trusted publisher, with environment `npm`.
5. Enable Renovate on the repository.

After that, a release is: add a changeset (`bun run changeset`), merge it, and run the `release` workflow on `main`.

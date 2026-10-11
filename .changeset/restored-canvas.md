---
"@a240/skye": minor
---

`skye-contextrestored` says whether the sky came back on a new canvas: its `detail` is now `{ replaced }`, true when the browser did not restore the context within `SkyeElement.restoreTimeoutMs` (or the sky moved between the worker and the main thread during the outage) and false when it restored the canvas it had. React's `onContextRestored` receives the same object. Types: the event's `detail` was `null` and is now the new `ContextRestored`, exported from `@a240/skye/element`. The core's `contextrestored` is unchanged, since a core sky always comes back on its own canvas.

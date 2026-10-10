---
"@a240/skye": patch
---

Fix `<skye-view worker>` holding back its events for good when the GPU never reports a frame as finished, as WebKit can after a lost context is restored: `skye-contextrestored` never arrived. The worker now waits about a second at most, and drops a frame's wait when the context is lost.

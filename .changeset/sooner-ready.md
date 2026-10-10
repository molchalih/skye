---
"@a240/skye": patch
---

Where the browser compiles shaders in the background, the sky notices that its shaders are ready within a few milliseconds instead of up to a frame later, so `ready` and the first frame come 10 to 15 ms sooner.

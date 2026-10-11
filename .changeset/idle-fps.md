---
"@a240/skye": patch
---

`stats().fps` reads 0 while the sky is asleep (stopped, hidden, off screen or lost) or drawing static frames, instead of the rate of the last frames it animated, and measures afresh once it animates again. In worker mode the page's snapshot catches up when the worker stops sending them.

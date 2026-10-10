---
"@a240/skye": patch
---

Static skies show the right frame on compositors that present a frame late. WebKit GTK and WPE can show a canvas one frame behind, so a static sky drew black at first and then the state before each change; each static frame is now drawn again on the next display frame, and the gradient goes a frame later, once the sky is on screen. `render(t)` callers who draw a single frame should draw it again on the next display frame.

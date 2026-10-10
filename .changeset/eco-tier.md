---
"@a240/skye": minor
---

Adds `quality="eco"`, an opt-in tier below `low` for battery-bound pages and background skies: the same sky, softer (a 0.75 pixel-ratio cap) and calmer (20 fps), at about 60 % of `low`'s GPU time per frame. `auto` never picks it, so no default image changes. Types: `Quality` and `Tier` gain `"eco"` (an exhaustive `switch` or a `Record<Tier, …>` needs the new case), `QUALITIES[1]` is now `"eco"`, and `TierChange.quality` narrows to the new `AutoTier` (low, balanced or high). Capped frame rates also keep a steady cadence on 144 and 165 Hz displays, where timestamp jitter could move a frame by one refresh.

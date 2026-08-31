---
"@nerima-games/mc-audio": patch
---

Pin `@nerima-games/mc-kernel` to `0.7.0` (exact, no caret), up from `^0.4.0`. Checked `footstepCueFor`'s closed `FootstepSurface` vocabulary (`'default' | 'grass' | 'wood' | 'stone'`) against kernel's `FOOTSTEP_MATERIALS`, which is unchanged between `0.4.0` and `0.7.0` — no cue lookup silently goes stale for a real block. No other kernel surface this package touches changed either, so no call sites needed adaptation.

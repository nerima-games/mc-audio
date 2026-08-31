# @nerima-games/mc-audio

## 0.2.8

### Patch Changes

- [#20](https://github.com/nerima-games/mc-audio/pull/20) [`6d46859`](https://github.com/nerima-games/mc-audio/commit/6d46859b2bb7d7fec034053db49d5fa69be9b81d) Thanks [@takeokunn](https://github.com/takeokunn)! - Pin `@nerima-games/mc-kernel` to `0.7.0` (exact, no caret), up from `^0.4.0`. Checked `footstepCueFor`'s closed `FootstepSurface` vocabulary (`'default' | 'grass' | 'wood' | 'stone'`) against kernel's `FOOTSTEP_MATERIALS`, which is unchanged between `0.4.0` and `0.7.0` — no cue lookup silently goes stale for a real block. No other kernel surface this package touches changed either, so no call sites needed adaptation.

- [#19](https://github.com/nerima-games/mc-audio/pull/19) [`cd2be30`](https://github.com/nerima-games/mc-audio/commit/cd2be30ce980859ee75ca4a43d4c188a41587f87) Thanks [@takeokunn](https://github.com/takeokunn)! - Complete the org toolchain devDependency pin set: knip 6.33.0 (its verify gate arrives in Wave 3; the pin belongs to the Wave 0 table) plus @effect/vitest 0.30.0 where it was missing.

## 0.2.7

### Patch Changes

- [#17](https://github.com/nerima-games/mc-audio/pull/17) [`4e69e28`](https://github.com/nerima-games/mc-audio/commit/4e69e28eeeb2ea7d333d6c4e84f4f00ccb9c5524) Thanks [@takeokunn](https://github.com/takeokunn)! - Toolchain frozen to org pin set (TypeScript 7.0.2, vitest 4.1.11, effect 3.22.1, node 24, pnpm 11.24.0); build switched to tsc emit; release workflow added

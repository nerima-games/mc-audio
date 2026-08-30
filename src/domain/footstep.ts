import type { SoundCueId } from './cue.js'

/** Surface vocabulary supplied by the block registry and consumed by audio. */
export const FOOTSTEP_SURFACES = ['default', 'grass', 'wood', 'stone'] as const
export type FootstepSurface = (typeof FOOTSTEP_SURFACES)[number]

/** Resolve a surface classification to the registered spatial cue. */
export const footstepCueFor = (surface: FootstepSurface): SoundCueId | undefined => {
  switch (surface) {
    case 'grass':
      return 'footstepGrass'
    case 'wood':
      return 'footstepWood'
    case 'stone':
      return 'footstepStone'
    case 'default':
      return
    // Unreachable: the switch above already exhausts every FootstepSurface
    // Member, so `surface` is narrowed to `never` here. This arm exists only
    // So a future addition to FOOTSTEP_SURFACES fails to compile instead of
    // Silently falling through. The `@preserve` suffix keeps the ignore hint
    // Through esbuild's TypeScript transpile step (vitest 4 /
    // @vitest/coverage-v8 4.x strips comments lacking it before coverage
    // Instrumentation sees them), hence the disables.
    // oxlint-disable-next-line capitalized-comments
    /* v8 ignore start -- @preserve */
    default: {
      const exhaustive: never = surface
      return exhaustive
    }
    // oxlint-disable-next-line capitalized-comments
    /* v8 ignore stop -- @preserve */
  }
}

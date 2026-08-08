import type { SoundCueId } from './cue'

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
    default: {
      const exhaustive: never = surface
      return exhaustive
    }
  }
}

/**
 * The sound cue roster and its registry.
 *
 * The static registry lives in `src/data`; this module retains the validation
 * and playback-facing domain types.
 */
import {
  CUE_DEFINITIONS,
  type CueDefinition,
  SOUND_CUE_IDS,
  type SoundCueId,
} from '../data/cue-definitions.js'
import type { Position } from '@nerima-games/mc-kernel'

export { CUE_DEFINITIONS, SOUND_CUE_IDS }
export type { CueDefinition, SoundCueId }

const CUE_ID_SET: ReadonlySet<string> = new Set(SOUND_CUE_IDS)

export const isSoundCueId = (value: string): value is SoundCueId =>
  CUE_ID_SET.has(value)

export const cueDefinition = (cueId: SoundCueId): CueDefinition =>
  CUE_DEFINITIONS[cueId]

export type CuePlayOptions = {
  readonly position?: Position
  /** Extra per-call scaling, e.g. a quieter footstep while sneaking. Clamped to >= 0. */
  readonly gainScale?: number
}

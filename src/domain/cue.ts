/**
 * The sound cue roster and its registry.
 *
 * The static registry lives in `src/data`; this module retains the validation
 * and playback-facing domain types.
 */
import {
  CUE_DEFINITIONS,
  CUE_DEFINITIONS_BY_ID,
  type CueDefinition,
  SOUND_CUE_IDS,
  SoundCueId,
} from '../data/cue-definitions.js'
import type { AudioGain } from './audio-brands.js'
import type { Position } from '@nerima-games/mc-kernel/domain/coordinates'

export { CUE_DEFINITIONS, SOUND_CUE_IDS }
export { SoundCueId }
export type { CueDefinition }

const CUE_ID_SET: ReadonlySet<string> = new Set(SOUND_CUE_IDS)

const getCueDefinition = <CueIdKey extends SoundCueId>(
  definitions: Readonly<Record<CueIdKey, CueDefinition>>,
  cueId: CueIdKey,
): CueDefinition => definitions[cueId]

export const isSoundCueId = (value: unknown): value is SoundCueId =>
  typeof value === 'string' && CUE_ID_SET.has(value)

export const cueDefinition = (cueId: SoundCueId): CueDefinition => getCueDefinition(CUE_DEFINITIONS_BY_ID, cueId)

export type CuePlayOptions = {
  readonly position?: Position
  /** Extra per-call scaling, e.g. a quieter footstep while sneaking. Clamped to >= 0. */
  readonly gainScale?: AudioGain
}

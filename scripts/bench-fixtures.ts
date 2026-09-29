/* oxlint-disable no-bitwise -- fixed-seed LCG deliberately uses 32-bit arithmetic. */
/**
 * Deterministic audio benchmark inputs.
 *
 * Adapted from mc-meshing's R-C5 fixture separation. Registered cues are kept
 * in source order; missing IDs are generated once with a fixed LCG seed so a
 * lookup benchmark has a stable hit/miss sequence and allocates no strings in
 * its timed loop.
 */
import { CUE_DEFINITIONS, SOUND_CUE_IDS, cueDefinition, isSoundCueId, type CueDefinition, type SoundCueId } from '../src/domain/cue.js'

export const REGISTERED_CUE_IDS: ReadonlyArray<SoundCueId> = SOUND_CUE_IDS

const missingCueIds = (): ReadonlyArray<string> => {
  const result: Array<string> = []
  let state = 0x5eed1234
  for (let index = 0; index < 256; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    result.push(`missing/${(state >>> 0).toString(16).padStart(8, '0')}`)
  }
  return result
}

export const MISSING_CUE_IDS: ReadonlyArray<string> = missingCueIds()
export const CUE_LOOKUP_IDS: ReadonlyArray<string> = [...REGISTERED_CUE_IDS, ...MISSING_CUE_IDS]

export const REGISTERED_CUE_DEFINITIONS: ReadonlyArray<CueDefinition> = REGISTERED_CUE_IDS.map((cueId) => CUE_DEFINITIONS[cueId])

export const lookupCue = (cueId: string): CueDefinition | null => (isSoundCueId(cueId) ? cueDefinition(cueId) : null)

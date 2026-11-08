import { type FootstepSurface, cueForSurface, surfaceForBlockType } from './footstep.js'
import { type SoundCueId, SoundCueId as makeSoundCueId } from './cue.js'
import { Result } from 'effect'

export type AudioEvent =
  | { readonly kind: 'mining'; readonly blockType: unknown }
  | { readonly kind: 'place'; readonly blockType: unknown }
  | { readonly kind: 'pickup' }
  | { readonly kind: 'attack' }
  | { readonly kind: 'hurt'; readonly target: 'player' | 'mob' }
  | { readonly kind: 'mobDeath' }
  | { readonly kind: 'footstep'; readonly blockType: unknown }
  | { readonly kind: 'ambient'; readonly layer?: 'rain' | 'thunder' }

export type AudioEventMapping = {
  readonly cueId: SoundCueId | null
  readonly surface?: FootstepSurface
}

export type AudioEventMapFailure = {
  readonly _tag: 'AudioEventMapFailure'
  readonly kind: 'mining' | 'place' | 'footstep'
  readonly blockType: string | null
  readonly reason: 'unknown-block-type' | 'invalid-type'
}

type RawSoundCueId = Parameters<typeof makeSoundCueId>[number]

const cue = (cueId: RawSoundCueId): SoundCueId => makeSoundCueId(cueId)

const surfaceFailure = (
  kind: AudioEventMapFailure['kind'],
  blockType: unknown,
): Result.Result<never, AudioEventMapFailure> => {
  let reason: AudioEventMapFailure['reason'] = 'invalid-type'
  let safeBlockType: string | null = null
  if (typeof blockType === 'string') {
    reason = 'unknown-block-type'
    safeBlockType = blockType
  }
  return Result.fail({
    _tag: 'AudioEventMapFailure',
    blockType: safeBlockType,
    kind,
    reason,
  })
}

const mapSurfaceEvent = (
  kind: 'mining' | 'place' | 'footstep',
  blockType: unknown,
): Result.Result<AudioEventMapping, AudioEventMapFailure> => {
  const surface = surfaceForBlockType(blockType)
  if (Result.isFailure(surface)) {
    return surfaceFailure(kind, blockType)
  }
  if (kind === 'mining') {
    return Result.succeed({ cueId: cue('blockBreak'), surface: surface.success })
  }
  if (kind === 'place') {
    return Result.succeed({ cueId: cue('blockPlace'), surface: surface.success })
  }
  return Result.succeed({ cueId: cueForSurface(surface.success) ?? null, surface: surface.success })
}

/** Map host events to the established sound cue roster without changing kernel event types. */
export const mapAudioEvent = (event: AudioEvent): Result.Result<AudioEventMapping, AudioEventMapFailure> => {
  switch (event.kind) {
    case 'mining':
    case 'place':
    case 'footstep':
      return mapSurfaceEvent(event.kind, event.blockType)
    case 'pickup':
      return Result.succeed({ cueId: cue('itemPickup') })
    case 'attack':
      return Result.succeed({ cueId: cue('entityHit') })
    case 'hurt': {
      if (event.target === 'player') {
        return Result.succeed({ cueId: cue('playerHurt') })
      }
      return Result.succeed({ cueId: cue('mobHurt') })
    }
    case 'mobDeath':
      return Result.succeed({ cueId: cue('mobDeath') })
    case 'ambient': {
      if (event.layer === 'thunder') {
        return Result.succeed({ cueId: cue('thunderClap') })
      }
      return Result.succeed({ cueId: cue('rainAmbient') })
    }
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

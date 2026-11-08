import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { mapAudioEvent } from '../src/domain/audio-event-map.js'

describe('audio event map', () => {
  it('maps mining and placement with the existing block surface classification', () => {
    expect(mapAudioEvent({ kind: 'mining', blockType: 'stone' })).toEqual(Result.succeed({
      cueId: 'blockBreak',
      surface: 'stone',
    }))
    expect(mapAudioEvent({ kind: 'place', blockType: 'oak_planks' })).toEqual(Result.succeed({
      cueId: 'blockPlace',
      surface: 'wood',
    }))
    expect(mapAudioEvent({ kind: 'mining', blockType: 'grass_block' })).toEqual(Result.succeed({
      cueId: 'blockBreak',
      surface: 'grass',
    }))
  })

  it('maps pickup, attack, player and mob hurt, mob death, and ambient events', () => {
    const cues = [
      [ { kind: 'pickup' }, 'itemPickup' ],
      [ { kind: 'attack' }, 'entityHit' ],
      [ { kind: 'hurt', target: 'player' }, 'playerHurt' ],
      [ { kind: 'hurt', target: 'mob' }, 'mobHurt' ],
      [ { kind: 'mobDeath' }, 'mobDeath' ],
      [ { kind: 'ambient' }, 'rainAmbient' ],
      [ { kind: 'ambient', layer: 'thunder' }, 'thunderClap' ],
    ] as const

    for (const [event, cueId] of cues) {
      const result = mapAudioEvent(event)
      expect(Result.isSuccess(result) && result.success.cueId).toBe(cueId)
    }
  })

  it('maps footsteps by surface and returns no custom cue for the default surface', () => {
    expect(mapAudioEvent({ kind: 'footstep', blockType: 'grass_block' })).toEqual(Result.succeed({
      cueId: 'footstepGrass',
      surface: 'grass',
    }))
    expect(mapAudioEvent({ kind: 'footstep', blockType: 'oak_log' })).toEqual(Result.succeed({
      cueId: 'footstepWood',
      surface: 'wood',
    }))
    expect(mapAudioEvent({ kind: 'footstep', blockType: 'stone' })).toEqual(Result.succeed({
      cueId: 'footstepStone',
      surface: 'stone',
    }))
    expect(mapAudioEvent({ kind: 'footstep', blockType: 'glass' })).toEqual(Result.succeed({
      cueId: null,
      surface: 'default',
    }))
  })

  it('returns typed failures for invalid and unknown block types', () => {
    expect(mapAudioEvent({ kind: 'mining', blockType: 'unknown_block' })).toEqual(Result.fail({
      _tag: 'AudioEventMapFailure',
      blockType: 'unknown_block',
      kind: 'mining',
      reason: 'unknown-block-type',
    }))
    expect(mapAudioEvent({ kind: 'footstep', blockType: null })).toEqual(Result.fail({
      _tag: 'AudioEventMapFailure',
      blockType: null,
      kind: 'footstep',
      reason: 'invalid-type',
    }))
  })
})

import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { AudioBackendPort, makeRecordingBackend } from '../src/domain/backend-port'
import { CaptionStream } from '../src/domain/caption'
import { CUE_DEFINITIONS, SOUND_CUE_IDS, isSoundCueId } from '../src/domain/cue'
import { makeSoundCueService } from '../src/domain/engine'
import { DEFAULT_VOLUME_SETTINGS } from '../src/domain/volume'

const EXPECTED_CUE_IDS = [
  'blockBreak',
  'blockPlace',
  'playerHurt',
  'entityHit',
  'mobHurt',
  'mobDeath',
  'enchant',
  'inventoryOpen',
  'itemPickup',
  'inventoryClose',
  'footstepGrass',
  'footstepStone',
  'footstepWood',
  'rainAmbient',
  'thunderClap',
  'levelUp',
  'achievementUnlock',
] as const

describe('sound cue contract', () => {
  it('pins the complete reference roster and the unknown-id boundary', () => {
    expect(SOUND_CUE_IDS).toStrictEqual(EXPECTED_CUE_IDS)
    expect(EXPECTED_CUE_IDS.every(isSoundCueId)).toBe(true)
    expect(isSoundCueId('unknownCue')).toBe(false)
    expect(isSoundCueId('BlockBreak')).toBe(false)
  })

  it.effect('routes every registered cue through the sound service to the backend', () =>
    Effect.gen(function* () {
      const recorded = yield* makeRecordingBackend('ready')
      const layers = Layer.merge(
        Layer.succeed(AudioBackendPort, recorded.backend),
        Layer.succeed(CaptionStream, { emit: () => Effect.void }),
      )
      const service = yield* makeSoundCueService({
        context: Effect.succeed({
          availability: 'ready' as const,
          enabled: true,
          listener: { x: 0, y: 64, z: 0 },
          settings: DEFAULT_VOLUME_SETTINGS,
        }),
        nowSecs: Effect.succeed(0),
      }).pipe(Effect.provide(layers))

      for (const cueId of SOUND_CUE_IDS) {
        yield* service.play(cueId, { position: { x: 1, y: 64, z: 0 } })
      }

      const played = yield* recorded.played
      expect(played).toHaveLength(SOUND_CUE_IDS.length)
      for (const [index, cueId] of SOUND_CUE_IDS.entries()) {
        const request = played[index]
        const definition = CUE_DEFINITIONS[cueId]
        expect(request).toMatchObject({
          durationSecs: definition.durationSecs,
          frequency: definition.frequency,
          loop: false,
          wave: definition.wave,
        })
      }
    }),
  )
})

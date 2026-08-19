import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  AudioBackendPort,
  UnavailableBackendLayer,
  makeRecordingBackend,
  type ToneRequest,
} from '../src/domain/backend-port'

const CUE: ToneRequest = {
  durationSecs: 0.07,
  frequency: 220,
  gain: 0.4,
  loop: false,
  pan: 0,
}

describe('makeRecordingBackend', () => {
  it.effect('records every master gain change in order', () =>
    Effect.gen(function* () {
      const recorded = yield* makeRecordingBackend('ready')
      yield* recorded.backend.setMasterGain(0.5)
      yield* recorded.backend.setMasterGain(0.8)
      expect(yield* recorded.masterGains).toStrictEqual([0.5, 0.8])
    }),
  )

  it.effect('answers stopTone for a handle it never played, same as a real backend would', () =>
    Effect.gen(function* () {
      const recorded = yield* makeRecordingBackend('ready')
      const handle = yield* recorded.backend.playTone(CUE)
      // Recording backends never make noise, so stopTone has nothing to
      // reconcile — the contract is only that it completes without error.
      yield* recorded.backend.stopTone(handle)
      expect(yield* recorded.played).toHaveLength(1)
    }),
  )

  it.effect('records music, active handles, and per-track gain changes', () =>
    Effect.gen(function* () {
      const recorded = yield* makeRecordingBackend('ready')
      const handle = yield* recorded.backend.playMusic({
        gain: 0.75,
        playbackRate: 1,
        soundId: 'minecraft:music/free_game',
        stream: false,
      })

      expect(yield* recorded.musicPlayed).toStrictEqual([
        { gain: 0.75, playbackRate: 1, soundId: 'minecraft:music/free_game', stream: false },
      ])
      expect(yield* recorded.backend.isToneActive(handle)).toBe(true)

      yield* recorded.backend.setToneGain(handle, 0.25)
      expect(yield* recorded.toneGains).toStrictEqual([{ gain: 0.25, handle }])

      yield* recorded.backend.stopTone(handle)
      expect(yield* recorded.backend.isToneActive(handle)).toBe(false)
    }),
  )
})

describe('UnavailableBackendLayer', () => {
  it.effect('reports unavailable and answers every call as a harmless no-op', () =>
    Effect.gen(function* () {
      const backend = yield* AudioBackendPort

      expect(yield* backend.availability).toBe('unavailable')

      const handle = yield* backend.playTone(CUE)
      expect(handle).toStrictEqual({ id: 0 })

      // Neither call has an observable effect on this backend; the contract
      // under test is that a caller who does not branch on "did I get a
      // handle" (per the module's own doc comment) can still call these
      // safely when there is no audio device at all.
      yield* backend.setMasterGain(0.5)
      yield* backend.setToneGain(handle, 0.25)
      expect(yield* backend.isToneActive(handle)).toBe(false)
      expect(yield* backend.playMusic({
        gain: 1,
        playbackRate: 1,
        soundId: 'minecraft:music/free_game',
        stream: false,
      })).toStrictEqual({ id: 0 })
      yield* backend.stopTone(handle)
    }).pipe(Effect.provide(UnavailableBackendLayer)),
  )
})

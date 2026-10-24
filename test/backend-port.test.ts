import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  AudioDurationSecs,
  AudioFrequencyHz,
  AudioGain,
  AudioPlaybackRate,
  AudioPan,
  AudioVolume,
  MinecraftSoundResourceId,
} from '../src/domain/audio-brands'
import {
  AudioBackendPort,
  UnavailableBackendLayer,
  makeRecordingBackend,
  type ToneRequest,
} from '../src/domain/backend-port'

const CUE: ToneRequest = {
  durationSecs: AudioDurationSecs(0.07),
  frequency: AudioFrequencyHz(220),
  gain: AudioGain(0.4),
  loop: false,
  pan: AudioPan(0),
}

describe('makeRecordingBackend', () => {
  it.effect('records every master gain change in order', () =>
    Effect.gen(function* () {
      const recorded = yield* makeRecordingBackend('ready')
      yield* recorded.backend.setMasterGain(AudioVolume(0.5))
      yield* recorded.backend.setMasterGain(AudioVolume(0.8))
      expect(yield* recorded.masterGains).toStrictEqual([0.5, 0.8])
    }),
  )

  it.effect('answers stopTone for a handle it never played, same as a real backend would', () =>
    Effect.gen(function* () {
      const recorded = yield* makeRecordingBackend('ready')
      const handle = yield* recorded.backend.playTone(CUE)
      expect(handle.accepted).toBe(true)
      // Recording backends never make noise, so stopTone has nothing to
      // reconcile — the contract is only that it completes without error.
      yield* recorded.backend.stopTone(handle)
      expect(yield* recorded.played).toHaveLength(1)
    }),
  )

  it.effect('answers accepted: false for playTone and playMusic when not ready, and tracks no active handle', () =>
    Effect.gen(function* () {
      const recorded = yield* makeRecordingBackend('locked')

      const toneHandle = yield* recorded.backend.playTone(CUE)
      expect(toneHandle.accepted).toBe(false)
      expect(yield* recorded.backend.isToneActive(toneHandle)).toBe(false)

      const musicHandle = yield* recorded.backend.playMusic({
        gain: AudioGain(0.75),
        playbackRate: AudioPlaybackRate(1),
        soundId: MinecraftSoundResourceId('minecraft:music/free_game'),
        stream: false,
      })
      expect(musicHandle.accepted).toBe(false)
      expect(yield* recorded.backend.isToneActive(musicHandle)).toBe(false)
    }),
  )

  it.effect('records music, active handles, and per-track gain changes', () =>
    Effect.gen(function* () {
      const recorded = yield* makeRecordingBackend('ready')
      const handle = yield* recorded.backend.playMusic({
        gain: AudioGain(0.75),
        playbackRate: AudioPlaybackRate(1),
        soundId: MinecraftSoundResourceId('minecraft:music/free_game'),
        stream: false,
      })

      expect(yield* recorded.musicPlayed).toStrictEqual([
        { gain: 0.75, playbackRate: 1, soundId: 'minecraft:music/free_game', stream: false },
      ])
      expect(handle.accepted).toBe(true)
      expect(yield* recorded.backend.isToneActive(handle)).toBe(true)

      yield* recorded.backend.setToneGain(handle, AudioGain(0.25))
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
      expect(handle).toStrictEqual({ accepted: false, id: 0 })

      // Neither call has an observable effect on this backend; the explicit
      // admission flag makes the no-op observable without making stopTone
      // unsafe for callers that still retain the diagnostic handle.
      yield* backend.setMasterGain(AudioVolume(0.5))
      yield* backend.setToneGain(handle, AudioGain(0.25))
      expect(yield* backend.isToneActive(handle)).toBe(false)
      expect(yield* backend.playMusic({
        gain: AudioGain(1),
        playbackRate: AudioPlaybackRate(1),
        soundId: MinecraftSoundResourceId('minecraft:music/free_game'),
        stream: false,
      })).toStrictEqual({ accepted: false, id: 0 })
      yield* backend.stopTone(handle)
    }).pipe(Effect.provide(UnavailableBackendLayer)),
  )
})

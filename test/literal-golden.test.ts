import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { AudioDurationSecs, AudioFrequencyHz, AudioGain, AudioPan } from '../src/domain/audio-brands.js'
import { cueDefinition, SoundCueId } from '../src/domain/cue.js'
import { makeWebAudioBackend } from '../src/domain/webaudio-adapter.js'
import { makeFakeWebAudio } from './fake-webaudio.js'

describe('origin/main literal golden cases', () => {
  it('looks up the origin/main blockBreak cue definition', () => {
    expect(cueDefinition(SoundCueId('blockBreak'))).toStrictEqual({
      baseGain: 0.4,
      caption: 'Block breaks',
      durationSecs: 0.07,
      frequency: 220,
      spatial: true,
      wave: 'square',
    })
  })

  it.effect('builds the origin/main representative mixer graph', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({ global: fake.global })
      yield* audio.unlock
      yield* audio.playTone({
        durationSecs: AudioDurationSecs(0.07),
        frequency: AudioFrequencyHz(220),
        gain: AudioGain(0.4),
        loop: false,
        pan: AudioPan(-0.5),
      })
      expect(fake.context()?.log.created).toStrictEqual(['gain#1', 'osc#2', 'gain#3', 'panner#4'])
      expect(fake.context()?.log.edges).toStrictEqual([
        { from: 'gain#1', to: 'destination' },
        { from: 'osc#2', to: 'gain#3' },
        { from: 'gain#3', to: 'panner#4' },
        { from: 'panner#4', to: 'gain#1' },
      ])
    }),
  )
})

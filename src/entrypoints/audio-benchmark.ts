import {
  type AudioCount,
  AudioCount as makeAudioCount,
  AudioPan as makeAudioPan,
} from '../domain/audio-brands.js'
import type { CueDefinition } from '../domain/cue.js'
import { Effect } from 'effect'
import type { WebAudioGlobalSurface } from '../domain/webaudio-surface.js'
import { makeWebAudioBackend } from '../domain/webaudio-adapter.js'

const NEXT_INDEX = 1
const SPATIAL_PAN_VALUE = -0.25
const CENTER_PAN_VALUE = 0
const SPATIAL_PAN = makeAudioPan(SPATIAL_PAN_VALUE)
const CENTER_PAN = makeAudioPan(CENTER_PAN_VALUE)

type AudioBenchmarkOptions = {
  readonly cues: ReadonlyArray<CueDefinition>
  readonly global: WebAudioGlobalSurface
  readonly maxConcurrentTones: AudioCount
  readonly metrics: () => {
    readonly allocations: AudioCount
    readonly connections: AudioCount
  }
}

export type AudioBenchmark = {
  readonly allocations: () => AudioCount
  readonly checksum: () => AudioCount
  readonly connections: () => AudioCount
  readonly run: (onComplete: () => void, onFailure: (cause: unknown) => void) => void
}

export const makeAudioBenchmark = (
  { cues, global, maxConcurrentTones, metrics }: AudioBenchmarkOptions,
  onReady: (benchmark: AudioBenchmark) => void,
  onFailure: (cause: unknown) => void,
): void => {
  Effect.runPromise(makeWebAudioBackend({ global, maxConcurrentTones }))
    .then((backend) =>
      Effect.runPromise(backend.unlock).then(() => {
        let index = 0
        let checksum = 0
        onReady({
          allocations: () => metrics().allocations,
          checksum: () => makeAudioCount(checksum),
          connections: () => metrics().connections,
          run: (onComplete, onRunFailure) => {
            const definition = cues[index % cues.length]
            if (definition === globalThis.undefined) {
              onRunFailure(new Error('Benchmark cue definitions are empty'))
              return
            }
            index += NEXT_INDEX
            let pan = CENTER_PAN
            if (definition.spatial) {
              pan = SPATIAL_PAN
            }
            Effect.runPromise(backend.playTone({
              durationSecs: definition.durationSecs,
              frequency: definition.frequency,
              gain: definition.baseGain,
              loop: false,
              pan,
              wave: definition.wave,
            }))
              .then((playback) => {
                if (playback.accepted) {
                  checksum += playback.id
                }
              })
              .then(onComplete, onRunFailure)
          },
        })
      }),
    )
    .catch(onFailure)
}

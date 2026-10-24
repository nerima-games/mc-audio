import { Effect } from 'effect'
import {
  type AudioCount,
  AudioCount as makeAudioCount,
  AudioPan as makeAudioPan,
} from '../domain/audio-brands.js'
import type { CueDefinition } from '../domain/cue.js'
import { makeWebAudioBackend } from '../domain/webaudio-adapter.js'
import type { WebAudioGlobalSurface } from '../domain/webaudio-surface.js'

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

export const makeAudioBenchmark = async ({
  cues,
  global,
  maxConcurrentTones,
  metrics,
}: AudioBenchmarkOptions): Promise<{
  readonly run: () => Promise<void>
  readonly allocations: () => AudioCount
  readonly connections: () => AudioCount
  readonly checksum: () => AudioCount
}> => {
  const backend = Effect.runSync(makeWebAudioBackend({ global, maxConcurrentTones }))
  await Effect.runPromise(backend.unlock)
  let index = 0
  let checksum = 0
  return {
    allocations: () => metrics().allocations,
    checksum: () => makeAudioCount(checksum),
    connections: () => metrics().connections,
    run: async () => {
      const definition = cues[index % cues.length]
      if (definition === globalThis.undefined) {
        throw new Error('Benchmark cue definitions are empty')
      }
      index += NEXT_INDEX
      let pan = CENTER_PAN
      if (definition.spatial) {
        pan = SPATIAL_PAN
      }
      const playback = await Effect.runPromise(backend.playTone({
        durationSecs: definition.durationSecs,
        frequency: definition.frequency,
        gain: definition.baseGain,
        loop: false,
        pan,
        wave: definition.wave,
      }))
      if (playback.accepted) {
        checksum += playback.id
      }
    },
  }
}

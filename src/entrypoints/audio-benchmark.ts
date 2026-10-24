import { Effect } from 'effect'
import { AudioCount, AudioPan } from '../domain/audio-brands.js'
import type { CueDefinition } from '../domain/cue.js'
import { makeWebAudioBackend } from '../domain/webaudio-adapter.js'
import type { WebAudioGlobalSurface } from '../domain/webaudio-surface.js'

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
    run: async () => {
      const definition = cues[index % cues.length]
      if (definition === undefined) {
        throw new Error('Benchmark cue definitions are empty')
      }
      index += 1
      const playback = await Effect.runPromise(backend.playTone({
        durationSecs: definition.durationSecs,
        frequency: definition.frequency,
        gain: definition.baseGain,
        loop: false,
        pan: AudioPan(definition.spatial ? -0.25 : 0),
        wave: definition.wave,
      }))
      if (playback.accepted) {
        checksum += playback.id
      }
    },
    allocations: () => metrics().allocations,
    connections: () => metrics().connections,
    checksum: () => AudioCount(checksum),
  }
}

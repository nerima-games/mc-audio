import { describe, expect, it } from 'vitest'
import { AudioCount, AudioGain } from '../src/domain/audio-brands'
import { cueDefinition, SoundCueId, type CueDefinition } from '../src/domain/cue'
import { makeAudioBenchmark, type AudioBenchmark } from '../src/entrypoints/audio-benchmark'
import { makeFakeWebAudio } from './fake-webaudio'

const benchmarkFor = (cues: ReadonlyArray<CueDefinition>) => {
  const fake = makeFakeWebAudio()
  const benchmark = new Promise<AudioBenchmark>((resolve, reject) => {
    makeAudioBenchmark(
      {
        cues,
        global: fake.global,
        maxConcurrentTones: AudioCount(100),
        metrics: () => ({ allocations: AudioCount(17), connections: AudioCount(23) }),
      },
      resolve,
      reject,
    )
  })
  return { benchmark, fake }
}

describe('audio benchmark entrypoint', () => {
  it('runs spatial and centered cues, skips refused plays in its checksum, and reads metrics', async () => {
    const cues = [
      cueDefinition(SoundCueId('footstepGrass')),
      cueDefinition(SoundCueId('itemPickup')),
      { ...cueDefinition(SoundCueId('footstepWood')), baseGain: AudioGain(0) },
    ]
    const { benchmark: pendingBenchmark, fake } = benchmarkFor(cues)
    const benchmark = await pendingBenchmark
    const run = () => new Promise<void>((resolve, reject) => benchmark.run(resolve, reject))

    expect(benchmark.allocations()).toBe(17)
    expect(benchmark.connections()).toBe(23)
    await run()
    await run()
    await run()

    expect(benchmark.checksum()).toBe(3)
    expect(fake.context()?.log.params.filter((call) => call.param === 'pan').map((call) => call.value)).toEqual([
      -0.25,
      0,
    ])
  })

  it('reports empty cue lists and forwards failures from its ready callback', async () => {
    const { benchmark: pendingEmptyBenchmark } = benchmarkFor([])
    const emptyBenchmark = await pendingEmptyBenchmark
    const emptyResult = await new Promise<'completed' | 'failed'>((resolve) => {
      emptyBenchmark.run(() => resolve('completed'), () => resolve('failed'))
    })
    expect(emptyResult).toBe('failed')

    const fake = makeFakeWebAudio()
    const expectedFailure = new Error('ready callback failed')
    const forwardedFailure = new Promise<unknown>((resolve) => {
      makeAudioBenchmark(
        {
          cues: [cueDefinition(SoundCueId('blockBreak'))],
          global: fake.global,
          maxConcurrentTones: AudioCount(100),
          metrics: () => ({ allocations: AudioCount(0), connections: AudioCount(0) }),
        },
        () => {
          throw expectedFailure
        },
        resolve,
      )
    })

    expect(await forwardedFailure).toBe(expectedFailure)
  })
})

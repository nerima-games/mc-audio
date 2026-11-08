import { Effect, Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { AudioCount, AudioSampleId } from '../src/domain/audio-brands.js'
import {
  audioAssetSampleManifest,
  makeAudioAssetLoader,
  selectAudioAsset,
  type AudioAssetSampleAdapter,
} from '../src/domain/audio-asset-loader.js'
import { decodeAudioAssetManifest, type AudioAssetManifest } from '../src/domain/audio-asset-manifest.js'
import { SoundCueId } from '../src/domain/cue.js'

const externalAttribution = {
  author: 'Example artist',
  licenseName: 'CC0 1.0 Universal',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  modified: false,
  sourceUrl: 'https://example.org/audio/step.ogg',
  type: 'external',
  workTitle: 'Step',
} as const

const decodedManifest = () => {
  const result = decodeAudioAssetManifest({
    blockBreak: [
      { attribution: externalAttribution, file: 'audio/break-a.ogg', pitchRange: { minimum: 1, maximum: 1 }, volume: 1 },
      { attribution: externalAttribution, file: 'audio/break-b.ogg', pitchRange: { minimum: 0.8, maximum: 1.2 }, volume: 0.75 },
    ],
    footstepGrass: [
      { attribution: externalAttribution, file: 'audio/step-generic.ogg', pitchRange: { minimum: 1, maximum: 1 }, volume: 1 },
      { attribution: externalAttribution, file: 'audio/step-grass.ogg', pitchRange: { minimum: 1, maximum: 1 }, surface: 'grass', volume: 1 },
      { attribution: externalAttribution, file: 'audio/step-stone.ogg', pitchRange: { minimum: 1, maximum: 1 }, surface: 'stone', volume: 1 },
    ],
  })
  if (Result.isFailure(result)) {
    throw new Error(result.failure.message)
  }
  return result.success
}

describe('audio asset loader', () => {
  it('converts cue variants into the existing sample manifest', () => {
    const samples = audioAssetSampleManifest(decodedManifest())

    expect([...samples.entries()]).toEqual([
      [AudioSampleId('mc-audio.asset:blockBreak:0'), { kind: 'url', url: 'audio/break-a.ogg' }],
      [AudioSampleId('mc-audio.asset:blockBreak:1'), { kind: 'url', url: 'audio/break-b.ogg' }],
      [AudioSampleId('mc-audio.asset:footstepGrass:0'), { kind: 'url', url: 'audio/step-generic.ogg' }],
      [AudioSampleId('mc-audio.asset:footstepGrass:1'), { kind: 'url', url: 'audio/step-grass.ogg' }],
      [AudioSampleId('mc-audio.asset:footstepGrass:2'), { kind: 'url', url: 'audio/step-stone.ogg' }],
    ])
  })

  it('reports failed variants against their cue while preserving aggregate cache counts', async () => {
    const calls: ReadonlyArray<AudioSampleId>[] = []
    const adapter: AudioAssetSampleAdapter = {
      preloadSamples: (sampleIds = []) => {
        calls.push([...sampleIds])
        const failedSampleIds = sampleIds.filter((sampleId) =>
          sampleId.startsWith('mc-audio.asset:blockBreak:') && sampleId.endsWith(':1'),
        )
        const failed = failedSampleIds.length
        return Effect.succeed({
          cached: AudioCount(0),
          failed: AudioCount(failed),
          failedSampleIds,
          loaded: AudioCount(sampleIds.length - failed),
          requested: AudioCount(sampleIds.length),
        })
      },
    }
    const loader = makeAudioAssetLoader({ adapter, manifest: decodedManifest() })

    await expect(Effect.runPromise(loader.preload)).resolves.toEqual({
      cached: 0,
      failed: 1,
      failures: [{
        _tag: 'AudioAssetLoadFailure',
        cueId: SoundCueId('blockBreak'),
        failedVariants: 1,
        files: ['audio/break-b.ogg'],
        reason: 'asset-load-failed',
      }],
      loaded: 4,
      requested: 5,
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual([
      AudioSampleId('mc-audio.asset:blockBreak:0'),
      AudioSampleId('mc-audio.asset:blockBreak:1'),
    ])
  })

  it('selects variants by surface and falls back to generic variants', () => {
    const manifest = decodedManifest()

    expect(selectAudioAsset({ cueId: SoundCueId('footstepGrass'), manifest, surface: 'grass' })).toMatchObject({
      success: {
        sampleId: AudioSampleId('mc-audio.asset:footstepGrass:1'),
        variantIndex: AudioCount(1),
      },
    })
    expect(selectAudioAsset({ cueId: SoundCueId('footstepGrass'), manifest, surface: 'stone' })).toMatchObject({
      success: {
        sampleId: AudioSampleId('mc-audio.asset:footstepGrass:2'),
        variantIndex: AudioCount(2),
      },
    })
    expect(selectAudioAsset({ cueId: SoundCueId('footstepGrass'), manifest })).toMatchObject({
      success: {
        sampleId: AudioSampleId('mc-audio.asset:footstepGrass:0'),
        variantIndex: AudioCount(0),
      },
    })
    expect(selectAudioAsset({ cueId: SoundCueId('blockBreak'), manifest: {} })).toMatchObject({
      failure: {
        _tag: 'AudioAssetSelectionFailure',
        reason: 'no-variants',
      },
    })
  })

  it('normalizes invalid runtime indexes and handles sparse or unmatched variant lists', () => {
    const manifest = decodedManifest()
    for (const variantIndex of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const request = JSON.parse(JSON.stringify({ cueId: SoundCueId('blockBreak'), manifest, variantIndex }))
      expect(selectAudioAsset(request)).toMatchObject({ success: { variantIndex: AudioCount(0) } })
    }

    const sparseVariants = new Array(1)
    const sparseManifest: AudioAssetManifest = { blockBreak: sparseVariants }
    expect(selectAudioAsset({ cueId: SoundCueId('blockBreak'), manifest: sparseManifest })).toMatchObject({
      failure: { _tag: 'AudioAssetSelectionFailure', reason: 'no-variants' },
    })

    const surfaceOnly = decodeAudioAssetManifest({
      footstepGrass: [
        { attribution: externalAttribution, file: 'audio/step-stone.ogg', pitchRange: { minimum: 1, maximum: 1 }, surface: 'stone', volume: 1 },
        { attribution: externalAttribution, file: 'audio/step-grass.ogg', pitchRange: { minimum: 1, maximum: 1 }, surface: 'grass', volume: 1 },
      ],
    })
    if (Result.isFailure(surfaceOnly)) {
      throw new Error(surfaceOnly.failure.message)
    }
    expect(selectAudioAsset({ cueId: SoundCueId('footstepGrass'), manifest: surfaceOnly.success, surface: 'wood' })).toMatchObject({
      success: { sampleId: AudioSampleId('mc-audio.asset:footstepGrass:0') },
    })
  })

  it('skips unknown and undefined cue entries while building manifests', async () => {
    const manifest: AudioAssetManifest = { unknownCue: [], blockBreak: undefined }
    expect(audioAssetSampleManifest(manifest)).toEqual(new Map())

    let preloadCalls = 0
    const loader = makeAudioAssetLoader({
      adapter: {
        preloadSamples: (sampleIds = []) => {
          preloadCalls += 1
          return Effect.succeed({
            cached: AudioCount(0),
            failed: AudioCount(0),
            loaded: AudioCount(sampleIds.length),
            requested: AudioCount(sampleIds.length),
          })
        },
      },
      manifest,
    })
    expect(loader.sampleManifest).toEqual(new Map())
    await expect(Effect.runPromise(loader.preload)).resolves.toEqual({
      cached: 0,
      failed: 0,
      failures: [],
      loaded: 0,
      requested: 0,
    })
    expect(preloadCalls).toBe(0)
  })

  it('does not attribute a failed file when an adapter reports only aggregate failures', async () => {
    const loader = makeAudioAssetLoader({
      adapter: {
        preloadSamples: (sampleIds = []) => {
          const failed = sampleIds.some((sampleId) => sampleId.startsWith('mc-audio.asset:blockBreak:'))
          return Effect.succeed({
            cached: AudioCount(0),
            failed: AudioCount(Number(failed)),
            loaded: AudioCount(sampleIds.length - Number(failed)),
            requested: AudioCount(sampleIds.length),
          })
        },
      },
      manifest: decodedManifest(),
    })

    await expect(Effect.runPromise(loader.preload)).resolves.toMatchObject({
      failures: [{ failedVariants: 1, files: [] }],
    })
  })

  it('reports a successful preload without creating failure rows', async () => {
    const manifest = decodedManifest()
    const loader = makeAudioAssetLoader({
      adapter: {
        preloadSamples: (sampleIds = []) => Effect.succeed({
          cached: AudioCount(0),
          failed: AudioCount(0),
          loaded: AudioCount(sampleIds.length),
          requested: AudioCount(sampleIds.length),
        }),
      },
      manifest,
    })

    await expect(Effect.runPromise(loader.preload)).resolves.toEqual({
      cached: 0,
      failed: 0,
      failures: [],
      loaded: 5,
      requested: 5,
    })
  })
})

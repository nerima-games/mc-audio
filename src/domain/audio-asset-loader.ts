/* oxlint-disable new-cap -- Audio brand constructors validate values at the adapter boundary. */
import type { AudioAssetManifest, AudioAssetPath, CueAudioAssetVariant } from './audio-asset-manifest.js'
import {
  AudioCount,
  AudioSampleId,
  type AudioSampleId as AudioSampleIdType,
  AudioSampleUrl,
} from './audio-brands.js'
import type { AudioSampleLoadReport, AudioSampleManifest, AudioSampleSource } from './audio-sample.js'
import { Effect, Result } from 'effect'
import { type SoundCueId, isSoundCueId } from './cue.js'
import type { FootstepSurface } from './footstep.js'

const EMPTY_COUNT = 0
const FIRST_VARIANT_INDEX = 0
const GENERIC_SAMPLE_NAMESPACE = 'mc-audio.asset'

export type AudioAssetLoadFailure = {
  readonly _tag: 'AudioAssetLoadFailure'
  readonly cueId: SoundCueId
  readonly failedVariants: AudioCount
  readonly files: ReadonlyArray<AudioAssetPath>
  readonly reason: 'asset-load-failed' | 'asset-missing'
  /** Variant index for a lazy playback failure; preload failures aggregate per cue. */
  readonly variantIndex?: number
}

export type AudioAssetLoadReport = {
  readonly requested: AudioCount
  readonly loaded: AudioCount
  readonly cached: AudioCount
  readonly failed: AudioCount
  readonly failures: ReadonlyArray<AudioAssetLoadFailure>
}

/** The sample-loading capability supplied by the WebAudio adapter. */
export type AudioAssetSampleAdapter = {
  readonly preloadSamples: (soundIds?: ReadonlyArray<AudioSampleIdType>) => Effect.Effect<AudioSampleLoadReport>
}

export type AudioAssetSelection = {
  readonly cueId: SoundCueId
  readonly sampleId: AudioSampleIdType
  readonly variant: CueAudioAssetVariant
  readonly variantIndex: number
}

export type AudioAssetSelectionFailure = {
  readonly _tag: 'AudioAssetSelectionFailure'
  readonly cueId: SoundCueId
  readonly reason: 'no-variants'
}

export type AudioAssetSelectionRequest = {
  readonly cueId: SoundCueId
  readonly manifest: AudioAssetManifest
  readonly surface?: FootstepSurface | undefined
  readonly variantIndex?: number
}

export type AudioAssetLoader = {
  readonly sampleManifest: AudioSampleManifest
  readonly preload: Effect.Effect<AudioAssetLoadReport>
}

const assetSampleId = (cueId: SoundCueId, variantIndex: number): AudioSampleIdType =>
  AudioSampleId(`${GENERIC_SAMPLE_NAMESPACE}:${cueId}:${variantIndex}`)

const variantsFor = (manifest: AudioAssetManifest, cueId: SoundCueId): ReadonlyArray<CueAudioAssetVariant> => {
  const foundEntry = Object.entries(manifest).find(([registeredCueId]) => registeredCueId === cueId)
  if (!foundEntry) {
    return []
  }
  const [, variants] = foundEntry
  if (!variants) {
    return []
  }
  return variants
}

const sampleEntriesForCue = (
  cueId: SoundCueId,
  variants: ReadonlyArray<CueAudioAssetVariant>,
): ReadonlyArray<readonly [AudioSampleIdType, AudioSampleSource]> =>
  variants.map((variant, variantIndex): readonly [AudioSampleIdType, AudioSampleSource] => [
    assetSampleId(cueId, variantIndex),
    { kind: 'url', url: AudioSampleUrl(variant.file) },
  ])

/** Convert cue variants into sample entries consumed by the existing WebAudio cache. */
export const audioAssetSampleManifest = (manifest: AudioAssetManifest): AudioSampleManifest => {
  const entries: Array<readonly [AudioSampleIdType, AudioSampleSource]> = []
  for (const [registeredCueId, variants] of Object.entries(manifest)) {
    if (isSoundCueId(registeredCueId) && variants) {
      entries.push(...sampleEntriesForCue(registeredCueId, variants))
    }
  }
  return new Map(entries)
}

const isGenericVariant = (variant: CueAudioAssetVariant): boolean => !Object.hasOwn(variant, 'surface')

type IndexedAssetVariant = { readonly index: number; readonly variant: CueAudioAssetVariant }

const genericCandidatesFor = (indexed: ReadonlyArray<IndexedAssetVariant>): ReadonlyArray<IndexedAssetVariant> => {
  const generic = indexed.filter(({ variant }) => isGenericVariant(variant))
  if (generic.length > EMPTY_COUNT) {
    return generic
  }
  return indexed
}

const surfaceCandidatesFor = (
  indexed: ReadonlyArray<IndexedAssetVariant>,
  surface: FootstepSurface,
): ReadonlyArray<IndexedAssetVariant> => {
  const matchingSurface = indexed.filter(({ variant }) => variant.surface === surface)
  if (matchingSurface.length > EMPTY_COUNT) {
    return matchingSurface
  }
  return genericCandidatesFor(indexed)
}

const candidatesFor = (
  manifest: AudioAssetManifest,
  cueId: SoundCueId,
  surface?: FootstepSurface,
): ReadonlyArray<IndexedAssetVariant> => {
  const indexed = variantsFor(manifest, cueId).map((variant, index) => ({ index, variant }))
  if (surface) {
    return surfaceCandidatesFor(indexed, surface)
  }
  return genericCandidatesFor(indexed)
}

const noVariantFailure = (cueId: SoundCueId): Result.Result<never, AudioAssetSelectionFailure> =>
  Result.fail({
    _tag: 'AudioAssetSelectionFailure',
    cueId,
    reason: 'no-variants',
  })

const selectionIndexFor = (requestedIndex: number, candidatesLength: number): number => {
  if (!Number.isSafeInteger(requestedIndex) || requestedIndex < FIRST_VARIANT_INDEX) {
    return FIRST_VARIANT_INDEX
  }
  return requestedIndex % candidatesLength
}

/** Select a stable variant, preferring the requested surface and then generic variants. */
export const selectAudioAsset = (
  request: AudioAssetSelectionRequest,
): Result.Result<AudioAssetSelection, AudioAssetSelectionFailure> => {
  const candidates = candidatesFor(request.manifest, request.cueId, request.surface)
  if (candidates.length === EMPTY_COUNT) {
    return noVariantFailure(request.cueId)
  }
  const requestedIndex = request.variantIndex ?? FIRST_VARIANT_INDEX
  const selectionIndex = selectionIndexFor(requestedIndex, candidates.length)
  const selected = candidates[selectionIndex]
  if (!selected) {
    return noVariantFailure(request.cueId)
  }
  return Result.succeed({
    cueId: request.cueId,
    sampleId: assetSampleId(request.cueId, selected.index),
    variant: selected.variant,
    variantIndex: selected.index,
  })
}

const cueEntries = (manifest: AudioAssetManifest): ReadonlyArray<readonly [SoundCueId, ReadonlyArray<CueAudioAssetVariant>]> => {
  const entries: Array<readonly [SoundCueId, ReadonlyArray<CueAudioAssetVariant>]> = []
  for (const [registeredCueId, variants] of Object.entries(manifest)) {
    if (isSoundCueId(registeredCueId) && variants) {
      entries.push([registeredCueId, variants])
    }
  }
  return entries
}

const preloadCueAssets = (input: {
  readonly adapter: AudioAssetSampleAdapter
  readonly cueId: SoundCueId
  readonly variants: ReadonlyArray<CueAudioAssetVariant>
}): Effect.Effect<AudioAssetLoadReport> => Effect.gen(function* preloadCueAssetsEffect() {
  const sampleIds = Array.from(input.variants.keys(), (variantIndex) => assetSampleId(input.cueId, variantIndex))
  const sampleReport = yield* input.adapter.preloadSamples(sampleIds)
  const failures: AudioAssetLoadFailure[] = []
  if (sampleReport.failed > EMPTY_COUNT) {
    const failedSampleIds = new Set(sampleReport.failedSampleIds ?? [])
    failures.push({
      _tag: 'AudioAssetLoadFailure',
      cueId: input.cueId,
      failedVariants: AudioCount(sampleReport.failed),
      files: input.variants.flatMap((variant, variantIndex) => {
        const sampleId = sampleIds[variantIndex]
        if (sampleId === globalThis.undefined || !failedSampleIds.has(sampleId)) {
          return []
        }
        return [variant.file]
      }),
      reason: 'asset-load-failed',
    })
  }
  return {
    cached: AudioCount(sampleReport.cached),
    failed: AudioCount(sampleReport.failed),
    failures,
    loaded: AudioCount(sampleReport.loaded),
    requested: AudioCount(sampleReport.requested),
  }
})

const emptyAudioAssetReport = (): AudioAssetLoadReport => ({
  cached: AudioCount(EMPTY_COUNT),
  failed: AudioCount(EMPTY_COUNT),
  failures: [],
  loaded: AudioCount(EMPTY_COUNT),
  requested: AudioCount(EMPTY_COUNT),
})

const combineAudioAssetReports = (reports: ReadonlyArray<AudioAssetLoadReport>): AudioAssetLoadReport =>
  reports.reduce((combined, next) => ({
    cached: AudioCount(combined.cached + next.cached),
    failed: AudioCount(combined.failed + next.failed),
    failures: [...combined.failures, ...next.failures],
    loaded: AudioCount(combined.loaded + next.loaded),
    requested: AudioCount(combined.requested + next.requested),
  }), emptyAudioAssetReport())

/** Preload through the existing adapter cache and report failures against their cue. */
export const makeAudioAssetLoader = (input: {
  readonly manifest: AudioAssetManifest
  readonly adapter: AudioAssetSampleAdapter
}): AudioAssetLoader => {
  const preload: Effect.Effect<AudioAssetLoadReport> = Effect.gen(function* preloadAudioAssets() {
    const reports: AudioAssetLoadReport[] = []
    for (const [cueId, variants] of cueEntries(input.manifest)) {
      reports.push(yield* preloadCueAssets({ adapter: input.adapter, cueId, variants }))
    }
    return combineAudioAssetReports(reports)
  })
  return { preload, sampleManifest: audioAssetSampleManifest(input.manifest) }
}

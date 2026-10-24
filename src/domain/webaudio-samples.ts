/**
 * Sample manifest orchestration for WebAudio.
 *
 * Loading and cache state are separate from node scheduling so that the
 * backend can keep its platform boundary focused on AudioContext operations.
 */
import { AudioSampleId, AudioCount as audioCount } from './audio-brands.js'
import type { AudioSampleLoadReport, AudioSampleManifest, AudioSampleSource } from './audio-sample.js'
import { Deferred, Effect } from 'effect'
import type { AudioBufferSurface } from './webaudio-surface.js'

const INITIAL_COUNT = 0
const COUNT_STEP = 1

export type AudioSamplePreloadOptions = {
  readonly manifest: AudioSampleManifest
  readonly cache: Map<AudioSampleId, AudioBufferSurface>
  readonly pendingLoads: Map<AudioSampleId, Deferred.Deferred<boolean>>
  readonly preloadedStreams: Set<AudioSampleId>
  readonly preloadStream: ((soundId: AudioSampleId, source: AudioSampleSource) => Effect.Effect<boolean, unknown>) | undefined
  readonly onlyPreload?: boolean
  readonly loadSample: (
    soundId: AudioSampleId,
    source: AudioSampleSource,
  ) => Effect.Effect<AudioBufferSurface | null>
}

type PreloadResult = 'cached' | 'failed' | 'loaded'

const addPreloadResult = (summary: AudioSampleLoadReport, result: PreloadResult): AudioSampleLoadReport => {
  if (result === 'cached') {
    return { ...summary, cached: audioCount(summary.cached + COUNT_STEP) }
  }
  if (result === 'failed') {
    return { ...summary, failed: audioCount(summary.failed + COUNT_STEP) }
  }
  return { ...summary, loaded: audioCount(summary.loaded + COUNT_STEP) }
}

const summarizePreloads = (results: ReadonlyArray<PreloadResult>): AudioSampleLoadReport =>
  results.reduce(
    (summary, result) => ({ ...addPreloadResult(summary, result), requested: audioCount(summary.requested + COUNT_STEP) }),
    { cached: audioCount(INITIAL_COUNT), failed: audioCount(INITIAL_COUNT), loaded: audioCount(INITIAL_COUNT), requested: audioCount(INITIAL_COUNT) },
  )

const startStreamLoad = (
  soundId: AudioSampleId,
  source: AudioSampleSource,
  options: AudioSamplePreloadOptions,
): Effect.Effect<boolean> => {
  const { preloadStream } = options
  if (!preloadStream) {
    return Effect.succeed(false)
  }
  return Effect.gen(function* startStreamLoadEffect() {
    const preload = yield* Effect.try({
      catch: (cause) => cause,
      try: () => preloadStream(soundId, source),
    })
    return yield* preload
  }).pipe(
    Effect.catch(() => Effect.succeed(false)),
    Effect.tap((loaded) => Effect.sync(() => {
      if (loaded) {
        options.preloadedStreams.add(soundId)
      }
    })),
  )
}

const startDecodedLoad = (
  soundId: AudioSampleId,
  source: AudioSampleSource,
  options: AudioSamplePreloadOptions,
): Effect.Effect<boolean> => options.loadSample(soundId, source).pipe(
  Effect.map((sample) => {
    if (sample === null) {
      return false
    }
    options.cache.set(soundId, sample)
    return true
  }),
)

const loadForSource = (
  soundId: AudioSampleId,
  source: AudioSampleSource,
  options: AudioSamplePreloadOptions,
): Effect.Effect<boolean> => {
  if (source.stream === true) {
    return startStreamLoad(soundId, source, options).pipe(
      Effect.flatMap((loaded) => {
        if (loaded) {
          return Effect.succeed(true)
        }
        return startDecodedLoad(soundId, source, options)
      }),
    )
  }
  return startDecodedLoad(soundId, source, options)
}

const startSampleLoad = (soundId: AudioSampleId, source: AudioSampleSource, options: AudioSamplePreloadOptions): Effect.Effect<boolean> =>
  Effect.gen(function* startSampleLoadEffect() {
    const existingLoad = options.pendingLoads.get(soundId)
    if (existingLoad) {
      return yield* Deferred.await(existingLoad)
    }

    const deferred = yield* Deferred.make<boolean>()
    options.pendingLoads.set(soundId, deferred)

    const load = loadForSource(soundId, source, options)
    const cleanup = Effect.sync(() => {
      if (options.pendingLoads.get(soundId) === deferred) {
        options.pendingLoads.delete(soundId)
      }
    })
    const completeLoad = Effect.exit(load).pipe(
      Effect.flatMap((exit) => Deferred.done(deferred, exit)),
      Effect.ensuring(cleanup),
    )
    yield* Effect.forkDetach(completeLoad)
    return yield* Deferred.await(deferred)
  })

const preloadStatus = (
  soundId: AudioSampleId,
  source: AudioSampleSource,
  options: AudioSamplePreloadOptions,
): PreloadResult | null => {
  if (source.stream === true && options.preloadedStreams.has(soundId)) {
    return 'cached'
  }
  return null
}

type PreloadDecision =
  | { readonly kind: 'result'; readonly result: PreloadResult }
  | { readonly kind: 'load'; readonly source: AudioSampleSource }

const preloadDecision = (soundId: AudioSampleId, options: AudioSamplePreloadOptions): PreloadDecision => {
  const source = options.manifest.get(soundId)
  if (!source) {
    return { kind: 'result', result: 'failed' }
  }
  const status = preloadStatus(soundId, source, options)
  if (status !== null) {
    return { kind: 'result', result: status }
  }
  return { kind: 'load', source }
}

const preloadOneSample = (soundId: AudioSampleId, options: AudioSamplePreloadOptions): Effect.Effect<PreloadResult> =>
  Effect.gen(function* preloadOneSampleEffect() {
    if (options.cache.has(soundId)) {
      return 'cached'
    }

    const decision = preloadDecision(soundId, options)
    if (decision.kind === 'result') {
      return decision.result
    }

    const loaded = yield* startSampleLoad(soundId, decision.source, options)
    if (loaded) {
      return 'loaded'
    }
    return 'failed'
  })

/** Load each requested sample once and report cache hits, loads, and failures. */
export const preloadAudioSamples = (
  soundIds: ReadonlyArray<AudioSampleId> | undefined,
  options: AudioSamplePreloadOptions,
): Effect.Effect<AudioSampleLoadReport> =>
  Effect.gen(function* preloadSamplesEffect() {
  const ids = [...new Set(soundIds ?? [...options.manifest.keys()])]
    let preloadIds = ids
    if (options.onlyPreload === true) {
      preloadIds = ids.filter((soundId) => options.manifest.get(soundId)?.preload === true)
    }
    const results = yield* Effect.forEach(preloadIds, (soundId) => preloadOneSample(soundId, options))
    return summarizePreloads(results)
  })

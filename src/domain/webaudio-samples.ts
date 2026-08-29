/**
 * Sample manifest orchestration for WebAudio.
 *
 * Loading and cache state are separate from node scheduling so that the
 * backend can keep its platform boundary focused on AudioContext operations.
 */
import type { AudioSampleLoadReport, AudioSampleManifest, AudioSampleSource } from './audio-sample.js'
import type { AudioBufferSurface } from './webaudio-surface.js'
import { Effect } from 'effect'

const INITIAL_COUNT = 0
const COUNT_STEP = 1

export type AudioSamplePreloadOptions = {
  readonly manifest: AudioSampleManifest
  readonly cache: Map<string, AudioBufferSurface>
  readonly pendingLoads: Map<string, Promise<boolean>>
  readonly preloadedStreams: Set<string>
  readonly preloadStream: ((soundId: string, source: AudioSampleSource) => Effect.Effect<boolean, unknown>) | undefined
  readonly onlyPreload?: boolean
  readonly loadSample: (
    soundId: string,
    source: AudioSampleSource,
  ) => Effect.Effect<AudioBufferSurface | null>
}

type PreloadResult = 'cached' | 'failed' | 'loaded'

const addPreloadResult = (summary: AudioSampleLoadReport, result: PreloadResult): AudioSampleLoadReport => {
  if (result === 'cached') {
    return { ...summary, cached: summary.cached + COUNT_STEP }
  }
  if (result === 'failed') {
    return { ...summary, failed: summary.failed + COUNT_STEP }
  }
  return { ...summary, loaded: summary.loaded + COUNT_STEP }
}

const summarizePreloads = (results: ReadonlyArray<PreloadResult>): AudioSampleLoadReport =>
  results.reduce(
    (summary, result) => ({ ...addPreloadResult(summary, result), requested: summary.requested + COUNT_STEP }),
    { cached: INITIAL_COUNT, failed: INITIAL_COUNT, loaded: INITIAL_COUNT, requested: INITIAL_COUNT },
  )

const startStreamLoad = (
  soundId: string,
  source: AudioSampleSource,
  options: AudioSamplePreloadOptions,
): Effect.Effect<boolean> => {
  if (!options.preloadStream) {
    return Effect.succeed(false)
  }
  return Effect.gen(function* startStreamLoadEffect() {
    const preload = yield* Effect.try({
      catch: (cause) => cause,
      try: () => options.preloadStream!(soundId, source),
    })
    return yield* preload
  }).pipe(
    Effect.catchAll(() => Effect.succeed(false)),
    Effect.tap((loaded) => Effect.sync(() => {
      if (loaded) {
        options.preloadedStreams.add(soundId)
      }
    })),
  )
}

const startDecodedLoad = (
  soundId: string,
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
  soundId: string,
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

const startSampleLoad = (soundId: string, source: AudioSampleSource, options: AudioSamplePreloadOptions): Promise<boolean> => {
  const existingLoad = options.pendingLoads.get(soundId)
  if (existingLoad) {
    return existingLoad
  }

  const load = loadForSource(soundId, source, options)
  const newLoad = Effect.runPromise(load.pipe(Effect.catchAll(() => Effect.succeed(false)))).finally(() =>
    options.pendingLoads.delete(soundId),
  )
  options.pendingLoads.set(soundId, newLoad)
  return newLoad
}

const preloadStatus = (
  soundId: string,
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

const preloadDecision = (soundId: string, options: AudioSamplePreloadOptions): PreloadDecision => {
  const source = options.manifest[soundId]
  if (!source) {
    return { kind: 'result', result: 'failed' }
  }
  const status = preloadStatus(soundId, source, options)
  if (status !== null) {
    return { kind: 'result', result: status }
  }
  return { kind: 'load', source }
}

const preloadOneSample = (soundId: string, options: AudioSamplePreloadOptions): Effect.Effect<PreloadResult> =>
  Effect.gen(function* preloadOneSampleEffect() {
    if (options.cache.has(soundId)) {
      return 'cached'
    }

    const decision = preloadDecision(soundId, options)
    if (decision.kind === 'result') {
      return decision.result
    }

    const loaded = yield* Effect.promise(() => startSampleLoad(soundId, decision.source, options))
    if (loaded) {
      return 'loaded'
    }
    return 'failed'
  })

/** Load each requested sample once and report cache hits, loads, and failures. */
export const preloadAudioSamples = (
  soundIds: ReadonlyArray<string> | undefined,
  options: AudioSamplePreloadOptions,
): Effect.Effect<AudioSampleLoadReport> =>
  Effect.gen(function* preloadSamplesEffect() {
    const ids = [...new Set(soundIds ?? Object.keys(options.manifest))]
    let preloadIds = ids
    if (options.onlyPreload === true) {
      preloadIds = ids.filter((soundId) => options.manifest[soundId]?.preload === true)
    }
    const results = yield* Effect.forEach(preloadIds, (soundId) => preloadOneSample(soundId, options))
    return summarizePreloads(results)
  })

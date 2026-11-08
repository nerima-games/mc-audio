/**
 * Sample manifest orchestration for WebAudio.
 *
 * Loading and cache state are separate from node scheduling so that the
 * backend can keep its platform boundary focused on AudioContext operations.
 */
import { AudioSampleId, type AudioSampleId as AudioSampleIdType, type AudioTimeoutMs, AudioCount as audioCount } from './audio-brands.js'
import type { AudioSampleLoadFailure, AudioSampleLoadReport, AudioSampleManifest, AudioSampleSource } from './audio-sample.js'
import { Deferred, Effect, Option } from 'effect'
import type { AudioBufferSurface } from './webaudio-surface.js'

const INITIAL_COUNT = 0
const IMMEDIATE_TIMEOUT_MS = 0
const COUNT_STEP = 1

export type AudioSamplePreloadOptions = {
  readonly manifest: AudioSampleManifest
  readonly cache: Map<AudioSampleId, AudioBufferSurface>
  readonly pendingLoads: Map<AudioSampleId, Deferred.Deferred<boolean>>
  readonly preloadedStreams: Set<AudioSampleId>
  readonly preloadStream: ((soundId: AudioSampleId, source: AudioSampleSource) => Effect.Effect<boolean, unknown>) | undefined
  readonly sampleLoadTimeoutMs: AudioTimeoutMs | null
  readonly effectSampleIds: ReadonlySet<AudioSampleId>
  readonly effectSampleLoadTimeoutMs: AudioTimeoutMs | null
  readonly useEffectSampleDeadline: boolean
  readonly recordLoadFailure: (
    soundId: AudioSampleId,
    source: AudioSampleSource,
    reason: Extract<AudioSampleLoadFailure['reason'], 'invalid-timeout' | 'load-timeout'>,
  ) => Effect.Effect<void>
  readonly onlyPreload?: boolean
  readonly loadSample: (
    soundId: AudioSampleId,
    source: AudioSampleSource,
  ) => Effect.Effect<AudioBufferSurface | null>
}

type PreloadStatus = 'cached' | 'failed' | 'loaded'
type PreloadResult = { readonly sampleId: AudioSampleIdType; readonly status: PreloadStatus }

const addPreloadResult = (summary: AudioSampleLoadReport, result: PreloadResult): AudioSampleLoadReport => {
  if (result.status === 'cached') {
    return { ...summary, cached: audioCount(summary.cached + COUNT_STEP) }
  }
  if (result.status === 'failed') {
    return {
      ...summary,
      failed: audioCount(summary.failed + COUNT_STEP),
      failedSampleIds: [...(summary.failedSampleIds ?? []), result.sampleId],
    }
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

const sampleWaitTimeoutFor = (soundId: AudioSampleId, options: AudioSamplePreloadOptions): AudioTimeoutMs | null => {
  if (options.useEffectSampleDeadline && options.effectSampleIds.has(soundId)) {
    return options.effectSampleLoadTimeoutMs
  }
  return options.sampleLoadTimeoutMs
}

const waitForSampleLoad = (input: {
  readonly soundId: AudioSampleId
  readonly source: AudioSampleSource
  readonly pendingLoad: Deferred.Deferred<boolean>
  readonly timeoutMs: AudioTimeoutMs
  readonly options: AudioSamplePreloadOptions
}): Effect.Effect<boolean> => Deferred.await(input.pendingLoad).pipe(
    Effect.timeoutOption(input.timeoutMs),
    Effect.flatMap((loaded) => Option.match(loaded, {
      onNone: () => input.options.recordLoadFailure(input.soundId, input.source, 'load-timeout').pipe(Effect.as(false)),
      onSome: Effect.succeed,
    })),
  )

const loadWithDeadline = (
  soundId: AudioSampleId,
  source: AudioSampleSource,
  options: AudioSamplePreloadOptions,
): Effect.Effect<boolean> => {
  const timeoutMs = options.sampleLoadTimeoutMs
  if (timeoutMs === null) {
    return options.recordLoadFailure(soundId, source, 'invalid-timeout').pipe(Effect.as(false))
  }
  if (timeoutMs === IMMEDIATE_TIMEOUT_MS) {
    return options.recordLoadFailure(soundId, source, 'load-timeout').pipe(Effect.as(false))
  }
  return loadForSource(soundId, source, options).pipe(
    Effect.timeoutOption(timeoutMs),
    Effect.flatMap((loaded) => Option.match(loaded, {
      onNone: () => options.recordLoadFailure(soundId, source, 'load-timeout').pipe(Effect.as(false)),
      onSome: Effect.succeed,
    })),
  )
}

const getOrStartSampleLoad = (
  soundId: AudioSampleId,
  source: AudioSampleSource,
  options: AudioSamplePreloadOptions,
): Effect.Effect<Deferred.Deferred<boolean>> => Effect.gen(function* getOrStartSampleLoadEffect() {
  const existingLoad = options.pendingLoads.get(soundId)
  if (existingLoad) {
    return existingLoad
  }

  const deferred = yield* Deferred.make<boolean>()
  options.pendingLoads.set(soundId, deferred)
  const load = loadWithDeadline(soundId, source, options)
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
  return deferred
})

const startSampleLoad = (soundId: AudioSampleId, source: AudioSampleSource, options: AudioSamplePreloadOptions): Effect.Effect<boolean> =>
  Effect.gen(function* startSampleLoadEffect() {
    const waitTimeoutMs = sampleWaitTimeoutFor(soundId, options)
    if (waitTimeoutMs === null) {
      yield* options.recordLoadFailure(soundId, source, 'invalid-timeout')
      return false
    }
    if (waitTimeoutMs === IMMEDIATE_TIMEOUT_MS) {
      yield* options.recordLoadFailure(soundId, source, 'load-timeout')
      return false
    }

    const pendingLoad = yield* getOrStartSampleLoad(soundId, source, options)
    return yield* waitForSampleLoad({
      options,
      pendingLoad,
      soundId,
      source,
      timeoutMs: waitTimeoutMs,
    })
  })

const preloadStatus = (
  soundId: AudioSampleId,
  source: AudioSampleSource,
  options: AudioSamplePreloadOptions,
): PreloadStatus | null => {
  if (source.stream === true && options.preloadedStreams.has(soundId)) {
    return 'cached'
  }
  return null
}

type PreloadDecision =
  | { readonly kind: 'result'; readonly result: PreloadStatus }
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
    const resultFor = (status: PreloadStatus): PreloadResult => ({ sampleId: soundId, status })
    if (options.cache.has(soundId)) {
      return resultFor('cached')
    }

    const decision = preloadDecision(soundId, options)
    if (decision.kind === 'result') {
      return resultFor(decision.result)
    }

    const loaded = yield* startSampleLoad(soundId, decision.source, options)
    if (loaded) {
      return resultFor('loaded')
    }
    return resultFor('failed')
  })

/** Load each requested sample once and report cache hits, loads, and failures. */
export const preloadAudioSamples = (
  soundIds: ReadonlyArray<AudioSampleId> | undefined,
  options: AudioSamplePreloadOptions,
): Effect.Effect<AudioSampleLoadReport> =>
  Effect.gen(function* preloadSamplesEffect() {
    let ids = [...options.manifest.keys()]
    if (soundIds !== globalThis.undefined) {
      ids = [...new Set(soundIds)]
    }
    let preloadIds = ids
    if (options.onlyPreload === true) {
      preloadIds = ids.filter((soundId) => options.manifest.get(soundId)?.preload === true)
    }
    const results = yield* Effect.forEach(preloadIds, (soundId) => preloadOneSample(soundId, options))
    return summarizePreloads(results)
  })

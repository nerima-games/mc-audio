/* oxlint-disable max-statements, new-cap, no-magic-numbers, no-ternary, no-undefined, sort-imports -- WebAudio setup is an ordered resource transaction; its API uses optional members, constructors held as values, normalized gain constants, and conditional node selection. */
/**
 * The WebAudio adapter — the one file in mc-audio that talks to a real device.
 *
 * `docs/architecture.md` §3 said this would be written LAST, and this is it.
 * Everything above it stayed pure while it did not exist, which is the property
 * that made it small: the cue roster, the gain arithmetic, the BGM state
 * machine and the caption stream are all already decided by the time control
 * reaches here, so this file schedules nodes and answers ONE question — can the
 * player actually hear anything.
 *
 * It compiles under `lib: ["ES2024"]` with no DOM, because every browser type
 * it names comes from `domain/webaudio-surface.ts`. Read that file's header
 * before this one; it explains why the surface exists, and it records the
 * fourth `AudioContextState` that nobody knew about.
 *
 * ---------------------------------------------------------------------------
 * THE GUARD, which is the whole point of the file
 * ---------------------------------------------------------------------------
 *
 * A browser will not start an `AudioContext` until the player has interacted
 * with the page. There are therefore three ways to have no sound, and
 * `domain/backend-port.ts` already names them: `unavailable`, `locked`,
 * `ready`. This adapter's job is to report the right one and never to pretend.
 *
 * The reference implementation had all three situations and could distinguish
 * none of them. Its guard was:
 *
 *     yield* Effect.tryPromise({
 *       try: () => context.resume(),
 *       catch: (cause) => cause,
 *     }).pipe(Effect.catch(() => Effect.void))          // audio-engine.ts:46-49
 *
 * — and then, on the very next line, it built the oscillator anyway. When the
 * autoplay policy refused, that code created a node graph, started it,
 * scheduled its stop, allocated a handle, and returned success, for a sound
 * that was never going to reach a speaker. Nothing above could observe it.
 * `docs/porting.md` §6 records the reason it was never caught: that file has
 * zero tests, and there is no way to write one, because the guard reads a
 * GLOBAL (`typeof AudioContext === 'undefined'`) that a Node test cannot make
 * false.
 *
 * Both halves are fixed here, and neither fix is clever:
 *
 *   1. THE FAILURE IS A VALUE. `resume()` rejecting produces `locked` and a
 *      counter in `WebAudioReport`, not a swallowed cause. `playTone` on a
 *      context that is not running builds NO NODES and increments
 *      `refusedTones`. Refusal is a thing you can print, assert on, and put in
 *      a bug report.
 *   2. THE GLOBAL IS AN ARGUMENT. `WebAudioGlobalSurface` is passed in, so
 *      "there is no Web Audio here" is a value a test can supply. Every branch
 *      in this file is reachable from Node, which is why
 *      `test/webaudio-adapter.test.ts` can exist at all.
 *
 * ---------------------------------------------------------------------------
 * What happens to a cue that is refused: it is DISCARDED
 * ---------------------------------------------------------------------------
 *
 * This adapter drops refused cues and counts them.
 *
 * Replaying is worse than it sounds. The cues that pile up before the first
 * click are the ones that fired during loading and the opening seconds; playing
 * them at the moment of unlock produces a burst of block-break and footstep
 * sounds for events that are already over — a sound telling the player about a
 * block that is no longer there. Audio is a statement about NOW, and a late
 * sound is not a delayed truth, it is a false one.
 *
 * Nothing is lost by dropping, because the information already went out:
 * `domain/engine.ts` emitted the caption BEFORE consulting the gate, with
 * `reason: 'gate-blocked'`. The player who could not hear it read it. That
 * ordering is what makes discarding an acceptable policy rather than a
 * shrugging one, and it is why `docs/design-notes.md` DN-1 is the invariant
 * this repository protects hardest.
 */
import { Deferred, Effect, Layer, Option, Ref } from 'effect'
import { AudioCount, AudioDurationSecs, AudioFrequencyHz, AudioGain, AudioHandleId, AudioPan, AudioPlaybackRate, AudioSampleId, AudioVolume } from './audio-brands.js'
import {
  type AudioAvailability,
  type AudioBackend,
  AudioBackendPort,
  type MusicRequest,
  type ToneHandle,
  type TonePlayback,
  type ToneRequest,
} from './backend-port.js'
import type { AudioSampleLoadReport, AudioSampleManifest, AudioSampleSource } from './audio-sample.js'
import { RELEASE_SECS, gainAt, toneEnvelope } from './envelope.js'
import { clamp01, clampNonNegative } from './volume.js'
import {
  availabilityForState,
  findWebAudioConstructor,
  type ContextRuntime,
  type WebAudioConstructorName,
} from './webaudio-runtime.js'
import type {
  AudioBufferSurface,
  AudioContextSurface,
  AudioContextStateSurface,
  AudioScheduledSourceSurface,
} from './webaudio-surface.js'
import type {
  WebAudioBackend,
  WebAudioOptions,
  WebAudioReport,
} from './webaudio-backend-types.js'
import { preloadAudioSamples } from './webaudio-samples.js'
import { buildToneGraph, type ActiveTone } from './webaudio-tone-graph.js'

export { DEFAULT_TONE_WAVE } from './webaudio-tone-graph.js'

/** A conservative ceiling that prevents pathological cue bursts from exhausting nodes. */
export const DEFAULT_MAX_CONCURRENT_TONES: AudioCount = AudioCount(32)

export type { AudioSampleLoadReport, AudioSampleManifest, AudioSampleSource } from './audio-sample.js'
export { availabilityForState } from './webaudio-runtime.js'
export type { WebAudioConstructorName } from './webaudio-runtime.js'
export type {
  WebAudioBackend,
  WebAudioOptions,
  WebAudioReport,
  WebAudioStreamSourceOptions,
} from './webaudio-backend-types.js'

/**
 * Run something against a node that may already be gone.
 *
 * `disconnect()` on an already-disconnected node and `stop()` on an oscillator
 * that has already ended both throw in some browsers and are silently fine in
 * others. The reference wrapped both for the same reason (`safeDisconnect`,
 * `safeStop`, `audio-context-helpers.ts:26-36`) and that part of it was right.
 * Cleanup that can throw turns a finished sound into an unhandled rejection.
 */
const ignoringFailure = (run: () => void): Effect.Effect<void> =>
  Effect.try({ catch: (cause) => cause, try: run }).pipe(Effect.catch(() => Effect.void))

const attempt = (run: () => void): Effect.Effect<boolean> =>
  Effect.try({
    catch: (cause) => cause,
    try: () => {
      run()
      return true
    },
  }).pipe(Effect.catch(() => Effect.succeed(false)))

const closeContext = (context: AudioContextSurface): Effect.Effect<void> =>
  Effect.tryPromise({
    catch: (cause) => cause,
    try: () => context.close(),
  }).pipe(Effect.catch(() => Effect.void))

const resolveMaxConcurrentTones = (value: AudioCount | undefined): Option.Option<AudioCount> => {
  if (value === undefined) {
    return Option.some(DEFAULT_MAX_CONCURRENT_TONES)
  }
  return Option.match(AudioCount.option(value), {
    onNone: () => Option.none<AudioCount>(),
    onSome: (validValue) => Option.some(AudioCount(Math.max(1, Math.floor(validValue)))),
  })
}

const resolvePlaybackRate = (playbackRate: AudioPlaybackRate | undefined): Option.Option<AudioPlaybackRate> => {
  if (playbackRate === undefined) {
    return Option.some(AudioPlaybackRate(1))
  }
  return AudioPlaybackRate.option(playbackRate)
}

type PlaybackAdmission = {
  readonly maxConcurrentTones: AudioCount
  readonly playbackRate: AudioPlaybackRate
  readonly request: AdmittedToneRequest
  readonly sampleId: Option.Option<AudioSampleId>
}

type AdmittedToneRequest = Omit<ToneRequest, 'soundId'> & { readonly soundId?: AudioSampleId }

const playbackAdmission = (
  request: ToneRequest,
  maxConcurrentTones: Option.Option<AudioCount>,
): Option.Option<PlaybackAdmission> => {
  if (Option.isNone(maxConcurrentTones)) {
    return Option.none()
  }

  const playbackRate = resolvePlaybackRate(request.playbackRate)
  if (Option.isNone(playbackRate)) {
    return Option.none()
  }

  const { soundId: untrustedSoundId, ...requestWithoutSoundId } = request
  const sampleId =
    untrustedSoundId === undefined ? Option.none<AudioSampleId>() : AudioSampleId.option(untrustedSoundId)
  if (untrustedSoundId !== undefined && Option.isNone(sampleId)) {
    return Option.none()
  }

  return Option.some({
    maxConcurrentTones: maxConcurrentTones.value,
    playbackRate: playbackRate.value,
    request: {
      ...requestWithoutSoundId,
      playbackRate: playbackRate.value,
      ...(Option.isSome(sampleId) ? { soundId: sampleId.value } : {}),
    },
    sampleId,
  })
}

const sampleDurationSecs = (
  buffer: AudioBufferSurface,
  playbackRate: AudioPlaybackRate,
): Option.Option<AudioDurationSecs> => {
  const { duration } = buffer
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    return Option.none<AudioDurationSecs>()
  }
  return AudioDurationSecs.option(duration / playbackRate)
}

const audioTime = (value: unknown): Option.Option<AudioDurationSecs> =>
  typeof value === 'number' ? AudioDurationSecs.option(value) : Option.none<AudioDurationSecs>()

const resolveSampleBuffer = (
  request: AdmittedToneRequest,
  options: WebAudioOptions,
  sampleCache: ReadonlyMap<AudioSampleId, AudioBufferSurface>,
): Effect.Effect<AudioBufferSurface | null> => {
  const { soundId } = request
  if (soundId === undefined) {
    return Effect.succeed(null)
  }
  return Effect.try({
    catch: (cause) => cause,
    try: () => {
      const cached = sampleCache.get(soundId)
      return options.resolveAudioBuffer?.(soundId) ?? cached ?? null
    },
  }).pipe(Effect.catch(() => Effect.succeed(null)))
}

type StreamSourceRequestOptions = {
  readonly context: AudioContextSurface
  readonly createStreamSource: WebAudioOptions['createStreamSource']
  readonly request: AdmittedToneRequest
  readonly sampleManifest: AudioSampleManifest
}

const streamSourceForRequest = ({
  context,
  createStreamSource,
  request,
  sampleManifest,
}: StreamSourceRequestOptions): Effect.Effect<AudioScheduledSourceSurface | null> => {
  if (request.stream !== true) {
    return Effect.succeed(null)
  }

  const { soundId } = request
  if (soundId === undefined || createStreamSource === undefined) {
    return Effect.succeed(null)
  }

  const source = sampleManifest.get(soundId)
  if (source === undefined || source.stream !== true) {
    return Effect.succeed(null)
  }

  return Effect.try({
    catch: (cause) => cause,
    try: () => createStreamSource({ context, request, soundId, source }),
  }).pipe(Effect.catch(() => Effect.succeed(null)))
}

/**
 * Build the adapter.
 *
 * NOTHING IS CONSTRUCTED HERE. No `new AudioContext()`, no node, no device
 * access — building the layer is free and silent, and a page that wires mc-audio
 * into its Layer graph at start-up does not thereby touch the audio hardware.
 * `docs/design-notes.md` DN-6 asks for exactly this ("生成は遅延で、最初の
 * `playTone` 時である。Layer 構築時ではない") and
 * `test/webaudio-adapter.test.ts` pins it by counting constructor calls.
 *
 * The context is created on the first `availability` read or `playTone` or
 * `unlock`, whichever comes first. `availability` is included deliberately:
 * `domain/engine.ts`'s `currentAvailability` is consulted while assembling
 * every `CueContext`, so an `availability` that declined to create would report
 * `unavailable` forever and no cue would ever play. Creating a context is not
 * the thing browsers restrict — it starts suspended and makes no sound.
 * `resume()` is the restricted call, and only `unlock` makes it.
 */
export const makeWebAudioBackend = (
  options: WebAudioOptions,
): Effect.Effect<WebAudioBackend> =>
  Effect.gen(function* buildWebAudioBackend() {
    const runtimeRef = yield* Ref.make<Option.Option<ContextRuntime>>(Option.none())
    const attemptedRef = yield* Ref.make(false)
    const masterGainValueRef = yield* Ref.make(clamp01(options.initialMasterGain ?? 0.8))
    const mutedRef = yield* Ref.make(false)
    const disposedRef = yield* Ref.make(false)
    const maxConcurrentTones = resolveMaxConcurrentTones(options.maxConcurrentTones)
    const activeTones = new Map<AudioHandleId, ActiveTone>()
    const nextIdRef = yield* Ref.make(0)
    const unlockAttemptsRef = yield* Ref.make(0)
    const unlockRefusalsRef = yield* Ref.make(0)
    const refusedTonesRef = yield* Ref.make(0)
    const capacityRefusalsRef = yield* Ref.make(0)
    let spontaneousStateChanges = 0
    const sampleCache = new Map<AudioSampleId, AudioBufferSurface>()
    const sampleLoads = new Map<AudioSampleId, Deferred.Deferred<boolean>>()
    const preloadedStreams = new Set<AudioSampleId>()
    const sampleManifest = options.sampleManifest ?? new Map()
    const autoPreloadStartedRef = yield* Ref.make(false)
    const autoPreloadEffectRef = yield* Ref.make<Effect.Effect<void>>(Effect.void)
    const hasConfiguredPreloads = [...sampleManifest.values()].some((source) => source.preload === true)

    /** Feature detection, as a value rather than as a global read. */
    const ensureRuntime: Effect.Effect<Option.Option<ContextRuntime>> = Effect.gen(function*  ensureRuntime() {
      if (yield* Ref.get(disposedRef)) {
        return Option.none<ContextRuntime>()
      }
      const cached = yield* Ref.get(runtimeRef)
      if (Option.isSome(cached)) {
        return cached
      }

      yield* Ref.set(attemptedRef, true)

      const found = findWebAudioConstructor(options.global)
      if (Option.isNone(found)) {
        return Option.none<ContextRuntime>()
      }

      // Construction itself can throw: a browser that has the constructor but
      // Has exhausted its hardware contexts (Chrome caps them at six per page)
      // Throws rather than returning a dead one. The reference guarded this
      // Too and was right to (`acquireAudioContext`, `Effect.try` +
      // `catchCause`). Returning `none` rather than failing keeps the
      // "never fails" shape that `AudioBackend` promises.
      const built = yield* Effect.try({
        catch: (cause) => cause,
        try: () => new found.value.construct(),
      }).pipe(Effect.catch(() => Effect.succeed(null)))

      if (built === null) {
        return Option.none<ContextRuntime>()
      }

      const initialGain = (yield* Ref.get(mutedRef)) ? 0 : yield* Ref.get(masterGainValueRef)

      const wired = yield* Effect.try({
        catch: (cause) => cause,
        try: (): ContextRuntime => {
          const master = built.createGain()
          master.gain.value = initialGain
          master.connect(built.destination)

          return {
            constructorName: found.value.name,
            context: built,
            master,
          }
        },
      }).pipe(Effect.catch(() => Effect.succeed(null)))

      if (wired === null) {
        yield* closeContext(built)
        return Option.none<ContextRuntime>()
      }

      // Counting spontaneous transitions is the only way an interruption that
      // Begins and ends between two cues leaves a trace. See `WebAudioReport`.
      yield* ignoringFailure(() => {
        built.onstatechange = () => {
          spontaneousStateChanges += 1
        }
      })

      const runtime = Option.some(wired)
      yield* Ref.set(runtimeRef, runtime)
      if (hasConfiguredPreloads && !(yield* Ref.get(autoPreloadStartedRef))) {
        yield* Ref.set(autoPreloadStartedRef, true)
        yield* Effect.forkDetach(yield* Ref.get(autoPreloadEffectRef))
      }
      return runtime
    })

    const currentAvailability: Effect.Effect<AudioAvailability> = Effect.map(
      ensureRuntime,
      Option.match({
        onNone: (): AudioAvailability => 'unavailable',
        onSome: (runtime) => availabilityForState(runtime.context.state),
      }),
    )

    const loadSample = (
      _soundId: AudioSampleId,
      source: AudioSampleSource,
    ): Effect.Effect<AudioBufferSurface | null> =>
      Effect.gen(function* loadSampleEffect() {
        const runtime = yield* ensureRuntime
        if (Option.isNone(runtime) || (yield* Ref.get(disposedRef))) {
          return null
        }
        const { loadSampleData } = options
        let data: ArrayBuffer | null = null
        if (source.kind === 'array-buffer') {
          const { data: arrayBuffer } = source
          data = arrayBuffer.slice(0)
        } else if (loadSampleData !== undefined) {
          const { url } = source
          data = yield* Effect.tryPromise({
            catch: (cause) => cause,
            try: () => loadSampleData(url),
          }).pipe(Effect.catch(() => Effect.succeed(null)))
        }
        if (data === null) {
          return null
        }
        const decoded = yield* Effect.tryPromise({
          catch: (cause) => cause,
          try: () => runtime.value.context.decodeAudioData(data),
        }).pipe(Effect.catch(() => Effect.succeed(null)))
        if (decoded === null || (yield* Ref.get(disposedRef))) {
          return null
        }
        return decoded
      })

    const preloadSamples = (soundIds?: ReadonlyArray<AudioSampleId>): Effect.Effect<AudioSampleLoadReport> =>
      preloadAudioSamples(soundIds, {
        cache: sampleCache,
        loadSample,
        manifest: sampleManifest,
        pendingLoads: sampleLoads,
        preloadStream: options.preloadStream,
        preloadedStreams,
      })

    const releaseTone = (tone: ActiveTone): Effect.Effect<void> =>
      Effect.gen(function* releaseActiveTone() {
        yield* ignoringFailure(() => tone.source.disconnect())
        yield* ignoringFailure(() => tone.gain.disconnect())
        yield* ignoringFailure(() => tone.panner.disconnect())
      })

    const removeActiveTone = (id: AudioHandleId): Effect.Effect<void> =>
      Effect.sync(() => {
        activeTones.delete(id)
      })

    const discardTone = (id: AudioHandleId, tone: ActiveTone): Effect.Effect<void> =>
      Effect.gen(function* discardFailedTone() {
        yield* removeActiveTone(id)
        yield* ignoringFailure(() => tone.source.stop())
        yield* releaseTone(tone)
      })

    const playTone = (request: ToneRequest): Effect.Effect<TonePlayback> =>
      Effect.gen(function* scheduleTone() {
        // Handles stay uniform across the admission gate; accepted is authoritative.
        const id = AudioHandleId(yield* Ref.updateAndGet(nextIdRef, (value) => value + 1))
        const refusedPlayback = (): TonePlayback => ({ accepted: false, id })
        const admission = playbackAdmission(request, maxConcurrentTones)
        if (Option.isNone(admission)) {
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          return refusedPlayback()
        }
        const { maxConcurrentTones: concurrentToneLimit, playbackRate, request: playbackRequest, sampleId } = admission.value

        const runtime = yield* ensureRuntime
        if (Option.isNone(runtime)) {
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          return refusedPlayback()
        }

        const { context, master } = runtime.value
        if (context.state !== 'running') {
          // NO RESUME HERE. This is the exact line the reference got wrong:
          // Calling `resume()` outside a user gesture is refused anyway, and
          // Swallowing that refusal is what let it build a node graph for a
          // Sound nobody could hear. Refusing early costs one counter and
          // Keeps the graph honest.
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          return refusedPlayback()
        }

        if (Option.isSome(sampleId) && sampleManifest.has(sampleId.value)) {
          yield* preloadSamples([sampleId.value]).pipe(Effect.asVoid)
        }

        if ((yield* Ref.get(disposedRef)) || context.state !== 'running') {
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          return refusedPlayback()
        }

        const sampleBuffer = yield* resolveSampleBuffer(playbackRequest, options, sampleCache)
        const canUseSample = sampleBuffer !== null && context.createBufferSource !== undefined
        const sampleDuration =
          canUseSample && sampleBuffer !== null && !playbackRequest.loop
            ? sampleDurationSecs(sampleBuffer, playbackRate)
            : Option.some(playbackRequest.durationSecs)
        if (Option.isNone(sampleDuration)) {
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          return refusedPlayback()
        }
        const scheduledRequest = { ...playbackRequest, durationSecs: sampleDuration.value }
        const startSecs = audioTime(context.currentTime)
        if (Option.isNone(startSecs)) {
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          return refusedPlayback()
        }
        const envelope = toneEnvelope(scheduledRequest, startSecs.value)
        if (envelope.peakGain === 0) {
          return refusedPlayback()
        }

        const activeCount = [...activeTones.values()].filter((tone) => !tone.releasing).length
        if (activeCount >= concurrentToneLimit) {
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          yield* Ref.update(capacityRefusalsRef, (count) => count + 1)
          return refusedPlayback()
        }

        const streamSource = yield* streamSourceForRequest({
          context,
          createStreamSource: options.createStreamSource,
          request: playbackRequest,
          sampleManifest,
        })

        const built = yield* buildToneGraph({
          context,
          envelope,
          master,
          playbackRate,
          request: playbackRequest,
          sampleBuffer: canUseSample ? sampleBuffer : null,
          streamSource,
        }).pipe(Effect.catch(() => Effect.succeed(null)))

        if (built === null) {
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          return refusedPlayback()
        }

        activeTones.set(id, built)

        const scheduled = yield* attempt(() => {
          built.source.start(envelope.startSecs)
          if (envelope.stopAtSecs !== null) {
            built.source.stop(envelope.stopAtSecs)
          }
        })

        if (!scheduled) {
          yield* discardTone(id, built)
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          return refusedPlayback()
        }

        yield* Effect.forkDetach(
          Effect.callback<void>((resume) => {
            built.source.onended = () => {
              activeTones.delete(id)
              built.source.onended = null
              resume(Effect.gen(function* releaseEndedTone() {
                yield* ignoringFailure(() => built.source.disconnect())
                yield* ignoringFailure(() => built.gain.disconnect())
                yield* ignoringFailure(() => built.panner.disconnect())
              }))
            }
          }),
          { startImmediately: true },
        )

        return { accepted: true, id }
      })

    const stopTone = (handle: ToneHandle): Effect.Effect<void> =>
      Effect.gen(function* stopActiveTone() {
        const tone = activeTones.get(handle.id)
        if (tone === undefined) {
          return
        }
        if (tone.releasing) {
          return
        }

        const runtime = yield* Ref.get(runtimeRef)
        // Unreachable: `tone` above only exists in `activeRef` because
        // `playTone` put it there, and `playTone` cannot add an entry without
        // `ensureRuntime` first setting `runtimeRef` to Some — which it never
        // Unsets. The `@preserve` suffix on the v8 ignore-hint below keeps the
        // Comment through esbuild's TypeScript transpile step (vitest 4 /
        // @vitest/coverage-v8 4.x strips comments that lack it before
        // Coverage instrumentation ever sees them — vitest.dev/guide/coverage
        // #ignoring-code); without it this hint silently stopped applying.
        // oxlint-disable-next-line capitalized-comments
        /* v8 ignore next 3 -- @preserve */
        if (Option.isNone(runtime)) {
          return
        }

        const { context } = runtime.value
        const now = audioTime(context.currentTime)
        if (Option.isNone(now)) {
          yield* discardTone(handle.id, tone)
          return
        }

        // Ramp down instead of stopping outright. `stopTone` is how a BGM track
        // Ends and how a looping cue is cancelled, and a loop cut mid-cycle at
        // Full amplitude is the loudest click this adapter could produce — a
        // Sustained tone is at full gain by definition, unlike a short cue
        // Which is usually already in its release when it ends.
        const nowSecs = now.value
        const stopped = yield* attempt(() => {
          // `cancelScheduledValues` first, or the tone's own release — already
          // On the automation timeline from `playTone` — competes with this
          // One and the parameter jumps between the two curves.
          tone.gain.gain.cancelScheduledValues(nowSecs)
          tone.gain.gain.setValueAtTime(gainAt(tone.envelope, nowSecs), nowSecs)
          tone.gain.gain.linearRampToValueAtTime(0, nowSecs + RELEASE_SECS)
          tone.source.stop(nowSecs + RELEASE_SECS)
        })
        if (!stopped) {
          yield* discardTone(handle.id, tone)
        } else {
          tone.releasing = true
        }
      })

    const setToneGain = (handle: ToneHandle, gain: AudioGain): Effect.Effect<void> =>
      Effect.gen(function* updateToneGain() {
        const tone = activeTones.get(handle.id)
        if (tone === undefined) {
          return
        }
        if (tone.releasing) {
          return
        }
        yield* ignoringFailure(() => {
          tone.gain.gain.value = clampNonNegative(gain)
        })
      })

    const isToneActive = (handle: ToneHandle): Effect.Effect<boolean> =>
      Effect.sync(() => activeTones.has(handle.id))

    const setMasterGain = (gain: AudioVolume): Effect.Effect<void> =>
      Effect.gen(function* updateMasterGain() {
        const next = clamp01(gain)
        yield* Ref.set(masterGainValueRef, next)

        // Remembered even when there is no context yet, so that a settings load
        // That happens before the first cue is not lost. The reference did this
        // Too (`masterGainValueRef`, `audio-engine.ts:19`) and it is the reason
        // The first cue after start-up is at the player's chosen volume rather
        // Than at the default.
        const runtime = yield* Ref.get(runtimeRef)
        if (Option.isNone(runtime)) {
          return
        }
        if (!(yield* Ref.get(mutedRef))) {
          yield* ignoringFailure(() => {
            runtime.value.master.gain.value = next
          })
        }
      })

    const setMuted = (muted: boolean): Effect.Effect<void> =>
      Effect.gen(function* updateMutedState() {
        yield* Ref.set(mutedRef, muted)
        const runtime = yield* Ref.get(runtimeRef)
        if (Option.isNone(runtime)) {
          return
        }
        const masterGain = yield* Ref.get(masterGainValueRef)
        yield* ignoringFailure(() => {
          runtime.value.master.gain.value = muted ? 0 : masterGain
        })
      })

    const unlock: Effect.Effect<AudioAvailability> = Effect.gen(function*  unlock() {
      yield* Ref.update(unlockAttemptsRef, (count) => count + 1)

      const runtime = yield* ensureRuntime
      if (Option.isNone(runtime)) {
        yield* Ref.update(unlockRefusalsRef, (count) => count + 1)
        return 'unavailable'
      }

      const {context} = runtime.value

      yield* Effect.tryPromise({
        catch: (cause) => cause,
        try: () => context.resume(),
      }).pipe(Effect.catch(() => Effect.void))

      // The state, not the promise. A resolved `resume()` is not a running
      // Context — see the doc comment on `WebAudioBackend.unlock`.
      const availability = availabilityForState(context.state)
      if (availability !== 'ready') {
        yield* Ref.update(unlockRefusalsRef, (count) => count + 1)
      }
      return availability
    })

    const playMusic = (request: MusicRequest): Effect.Effect<TonePlayback> =>
      Effect.gen(function* scheduleMusic() {
        const sampleId = AudioSampleId.option(request.soundId)
        if (Option.isSome(sampleId)) {
          yield* preloadSamples([sampleId.value]).pipe(Effect.asVoid)
        }
        return yield* playTone({
          durationSecs: AudioDurationSecs(1),
          frequency: AudioFrequencyHz(20),
          gain: request.gain,
          loop: false,
          naturalDuration: true,
          pan: AudioPan(0),
          playbackRate: request.playbackRate,
          sampleOnly: true,
          soundId: request.soundId,
          stream: request.stream,
        })
      })

    // No Effect.catch wrapper: `preloadAudioSamples` types its error channel
    // As `never` (per-sample failures are reported in the returned counts,
    // Not thrown), so there is nothing for a catch here to ever handle.
    const autoPreload = preloadAudioSamples(undefined, {
      cache: sampleCache,
      loadSample,
      manifest: sampleManifest,
      onlyPreload: true,
      pendingLoads: sampleLoads,
      preloadStream: options.preloadStream,
      preloadedStreams,
    }).pipe(Effect.asVoid)
    yield* Ref.set(autoPreloadEffectRef, autoPreload)

    const report: Effect.Effect<WebAudioReport> = Effect.gen(function*  report() {
      const runtime = yield* Ref.get(runtimeRef)
      return {
        activeTones: AudioCount(activeTones.size),
        availability: Option.match(runtime, {
          onNone: (): AudioAvailability => 'unavailable',
          onSome: (value) => availabilityForState(value.context.state),
        }),
        capacityRefusals: AudioCount(yield* Ref.get(capacityRefusalsRef)),
        constructorName: Option.match(runtime, {
          onNone: (): WebAudioConstructorName | null => null,
          onSome: (value) => value.constructorName,
        }),
        contextAttempted: yield* Ref.get(attemptedRef),
        contextState: Option.match(runtime, {
          onNone: (): AudioContextStateSurface | null => null,
          onSome: (value) => value.context.state,
        }),
        disposed: yield* Ref.get(disposedRef),
        muted: yield* Ref.get(mutedRef),
        refusedTones: AudioCount(yield* Ref.get(refusedTonesRef)),
        spontaneousStateChanges: AudioCount(spontaneousStateChanges),
        unlockAttempts: AudioCount(yield* Ref.get(unlockAttemptsRef)),
        unlockRefusals: AudioCount(yield* Ref.get(unlockRefusalsRef)),
      }
    })

    const dispose: Effect.Effect<void> = Effect.gen(function*  dispose() {
      if (yield* Ref.getAndSet(disposedRef, true)) {
        return
      }
      const runtime = yield* Ref.get(runtimeRef)
      if (Option.isNone(runtime)) {
        sampleCache.clear()
        preloadedStreams.clear()
        sampleLoads.clear()
        return
      }
      for (const tone of activeTones.values()) {
        yield* ignoringFailure(() => tone.source.stop())
        yield* releaseTone(tone)
      }
      activeTones.clear()
      sampleCache.clear()
      preloadedStreams.clear()
      sampleLoads.clear()
      yield* closeContext(runtime.value.context)
    })

    return {
      availability: currentAvailability,
      dispose,
      isToneActive,
      playMusic,
      playTone,
      preloadSamples,
      report,
      setMasterGain,
      setMuted,
      setToneGain,
      stopTone,
      unlock,
    }
  })

/**
 * The adapter as a Layer, for a host that only needs `AudioBackendPort`.
 *
 * Note what this DISCARDS: `unlock`, `report`, `setMuted`, `dispose` and
 * `preloadSamples` are not on
 * `AudioBackend`, so a consumer wired only through this Layer cannot unlock the
 * context and will stay `locked` forever. That is a real foot-gun and it is
 * left visible rather than papered over — the alternative is widening
 * `AudioBackendPort` with a method that every non-browser backend in every
 * downstream repository would have to implement as a lie.
 *
 * A host that wants sound calls `makeWebAudioBackend` once, keeps the value,
 * hands `unlock` to its first click handler, and provides the rest as a Layer.
 * mc-compose is where that wiring belongs (`docs/porting.md` §4).
 */
export const webAudioBackendLayer = (
  options: WebAudioOptions,
): Layer.Layer<AudioBackendPort> =>
  Layer.effect(
    AudioBackendPort,
    Effect.map(
      makeWebAudioBackend(options),
      (backend): AudioBackend => ({
        availability: backend.availability,
        isToneActive: backend.isToneActive,
        playMusic: backend.playMusic,
        playTone: backend.playTone,
        setMasterGain: backend.setMasterGain,
        setToneGain: backend.setToneGain,
        stopTone: backend.stopTone,
      }),
    ),
  )

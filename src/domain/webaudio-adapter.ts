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
 *       catch: () => new Error('AudioContext resume failed'),
 *     }).pipe(Effect.catchAllCause(() => Effect.void))    // audio-engine.ts:46-49
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
 * `docs/public-api.md` §7 lists a pending queue as an open question — replay
 * refused cues after unlock, or drop them. This adapter drops them, and counts
 * them.
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
import { Effect, Layer, Option, Ref } from 'effect'
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
export const DEFAULT_MAX_CONCURRENT_TONES = 32

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
  Effect.try({ catch: (cause) => cause, try: run }).pipe(Effect.catchAll(() => Effect.void))

const attempt = (run: () => void): Effect.Effect<boolean> =>
  Effect.try({
    catch: (cause) => cause,
    try: () => {
      run()
      return true
    },
  }).pipe(Effect.catchAll(() => Effect.succeed(false)))

const closeContext = (context: AudioContextSurface): Effect.Effect<void> =>
  Effect.tryPromise({
    catch: (cause) => cause,
    try: () => context.close(),
  }).pipe(Effect.catchAll(() => Effect.void))

const resolveMaxConcurrentTones = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value)
    ? DEFAULT_MAX_CONCURRENT_TONES
    : Math.max(1, Math.floor(value))

const resolvePlaybackRate = (playbackRate: number | undefined): number =>
  playbackRate !== undefined && Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1

const sampleDurationSecs = (
  buffer: AudioBufferSurface,
  playbackRate: number,
  fallbackDurationSecs: number,
): number =>
  Number.isFinite(buffer.duration) && buffer.duration >= 0
    ? buffer.duration / playbackRate
    : fallbackDurationSecs

const resolveSampleBuffer = (
  request: ToneRequest,
  options: WebAudioOptions,
  sampleCache: ReadonlyMap<string, AudioBufferSurface>,
): AudioBufferSurface | null => {
  const { soundId } = request
  if (soundId === undefined) {
    return null
  }
  try {
    return options.resolveAudioBuffer?.(soundId) ?? sampleCache.get(soundId) ?? null
  } catch {
    return null
  }
}

type StreamSourceRequestOptions = {
  readonly context: AudioContextSurface
  readonly createStreamSource: WebAudioOptions['createStreamSource']
  readonly request: ToneRequest
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

  const source = sampleManifest[soundId]
  if (source === undefined || source.stream !== true) {
    return Effect.succeed(null)
  }

  return Effect.try({
    catch: (cause) => cause,
    try: () => createStreamSource({ context, request, soundId, source }),
  }).pipe(Effect.catchAll(() => Effect.succeed(null)))
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
    const activeRef = yield* Ref.make<ReadonlyMap<number, ActiveTone>>(new Map())
    const nextIdRef = yield* Ref.make(0)
    const unlockAttemptsRef = yield* Ref.make(0)
    const unlockRefusalsRef = yield* Ref.make(0)
    const refusedTonesRef = yield* Ref.make(0)
    const capacityRefusalsRef = yield* Ref.make(0)
    const stateChangesRef = yield* Ref.make(0)
    const sampleCache = new Map<string, AudioBufferSurface>()
    const sampleLoads = new Map<string, Promise<boolean>>()
    const preloadedStreams = new Set<string>()
    const sampleManifest = options.sampleManifest ?? {}
    const autoPreloadStartedRef = yield* Ref.make(false)
    const autoPreloadEffectRef = yield* Ref.make<Effect.Effect<void>>(Effect.void)
    const hasConfiguredPreloads = Object.values(sampleManifest).some((source) => source.preload === true)

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
      // `catchAllCause`). Returning `none` rather than failing keeps the
      // "never fails" shape that `AudioBackend` promises.
      const built = yield* Effect.try({
        catch: (cause) => cause,
        try: () => new found.value.construct(),
      }).pipe(Effect.catchAll(() => Effect.succeed(null)))

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
      }).pipe(Effect.catchAll(() => Effect.succeed(null)))

      if (wired === null) {
        yield* closeContext(built)
        return Option.none<ContextRuntime>()
      }

      // Counting spontaneous transitions is the only way an interruption that
      // Begins and ends between two cues leaves a trace. See `WebAudioReport`.
      yield* ignoringFailure(() => {
        built.onstatechange = () => {
          Effect.runSync(Ref.update(stateChangesRef, (count) => count + 1))
        }
      })

      const runtime = Option.some(wired)
      yield* Ref.set(runtimeRef, runtime)
      if (hasConfiguredPreloads && !(yield* Ref.get(autoPreloadStartedRef))) {
        yield* Ref.set(autoPreloadStartedRef, true)
        yield* Effect.forkDaemon(yield* Ref.get(autoPreloadEffectRef))
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
      _soundId: string,
      source: AudioSampleSource,
    ): Effect.Effect<AudioBufferSurface | null> =>
      Effect.gen(function* loadSampleEffect() {
        const runtime = yield* ensureRuntime
        if (Option.isNone(runtime) || (yield* Ref.get(disposedRef))) {
          return null
        }
        const loadData = (): Promise<ArrayBuffer> => {
          if (source.kind === 'array-buffer') {
            return Promise.resolve(source.data.slice(0))
          }
          if (options.loadSampleData === undefined) {
            return Promise.reject(new Error('No sample URL loader configured'))
          }
          return options.loadSampleData(source.url)
        }
        const data = yield* Effect.tryPromise({
          catch: (cause) => cause,
          try: loadData,
        }).pipe(Effect.catchAll(() => Effect.succeed(null)))
        if (data === null) {
          return null
        }
        const decoded = yield* Effect.tryPromise({
          catch: (cause) => cause,
          try: () => runtime.value.context.decodeAudioData(data),
        }).pipe(Effect.catchAll(() => Effect.succeed(null)))
        if (decoded === null || (yield* Ref.get(disposedRef))) {
          return null
        }
        return decoded
      })

    const preloadSamples = (soundIds?: ReadonlyArray<string>): Effect.Effect<AudioSampleLoadReport> =>
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

    const removeActiveTone = (id: number): Effect.Effect<void> =>
      Ref.update(activeRef, (current) => {
        const next = new Map(current)
        next.delete(id)
        return next
      })

    const discardTone = (id: number, tone: ActiveTone): Effect.Effect<void> =>
      Effect.gen(function* discardFailedTone() {
        yield* removeActiveTone(id)
        yield* ignoringFailure(() => tone.source.stop())
        yield* releaseTone(tone)
      })

    const playTone = (request: ToneRequest): Effect.Effect<TonePlayback> =>
      Effect.gen(function* scheduleTone() {
        // Handles stay uniform across the admission gate; accepted is authoritative.
        const id = yield* Ref.updateAndGet(nextIdRef, (value) => value + 1)
        const refusedPlayback = (): TonePlayback => ({ accepted: false, id })

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

        if (request.soundId !== undefined && sampleManifest[request.soundId] !== undefined) {
          yield* preloadSamples([request.soundId]).pipe(Effect.asVoid)
        }

        if ((yield* Ref.get(disposedRef)) || context.state !== 'running') {
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          return refusedPlayback()
        }

        const playbackRate = resolvePlaybackRate(request.playbackRate)
        const sampleBuffer = resolveSampleBuffer(request, options, sampleCache)
        const canUseSample = sampleBuffer !== null && context.createBufferSource !== undefined
        const scheduledRequest =
          canUseSample && sampleBuffer !== null && !request.loop
            ? {
                ...request,
                durationSecs: sampleDurationSecs(sampleBuffer, playbackRate, request.durationSecs),
              }
            : request
        const envelope = toneEnvelope(scheduledRequest, context.currentTime)
        if (envelope.peakGain === 0) {
          return refusedPlayback()
        }

        const activeTones = (yield* Ref.get(activeRef)).values()
        const activeCount = [...activeTones].filter((tone) => !tone.releasing).length
        if (activeCount >= maxConcurrentTones) {
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          yield* Ref.update(capacityRefusalsRef, (count) => count + 1)
          return refusedPlayback()
        }

        const streamSource = yield* streamSourceForRequest({
          context,
          createStreamSource: options.createStreamSource,
          request,
          sampleManifest,
        })

        const built = yield* Effect.try({
          catch: (cause) => cause,
          try: () =>
            buildToneGraph({
              context,
              envelope,
              master,
              playbackRate,
              request,
              sampleBuffer: canUseSample ? sampleBuffer : null,
              streamSource,
            }),
        }).pipe(Effect.catchAll(() => Effect.succeed(null)))

        if (built === null) {
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          return refusedPlayback()
        }

        yield* Ref.update(activeRef, (current) => new Map(current).set(id, built))

        yield* ignoringFailure(() => {
          built.source.onended = () => {
            Effect.runSync(
              Effect.gen(function*  onended() {
                yield* releaseTone(built)
                yield* removeActiveTone(id)
              }),
            )
          }
        })

        const scheduled = yield* attempt(() => {
          built.source.start(envelope.startSecs)
          if (envelope.stopAtSecs !== null) {
            built.source.stop(envelope.stopAtSecs)
          }
        })

        if (!scheduled) {
          yield* discardTone(id, built)
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
        }

        return { accepted: scheduled, id }
      })

    const stopTone = (handle: ToneHandle): Effect.Effect<void> =>
      Effect.gen(function* stopActiveTone() {
        const tone = (yield* Ref.get(activeRef)).get(handle.id)
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

        const now = runtime.value.context.currentTime

        // Ramp down instead of stopping outright. `stopTone` is how a BGM track
        // Ends and how a looping cue is cancelled, and a loop cut mid-cycle at
        // Full amplitude is the loudest click this adapter could produce — a
        // Sustained tone is at full gain by definition, unlike a short cue
        // Which is usually already in its release when it ends.
        const stopped = yield* attempt(() => {
          // `cancelScheduledValues` first, or the tone's own release — already
          // On the automation timeline from `playTone` — competes with this
          // One and the parameter jumps between the two curves.
          tone.gain.gain.cancelScheduledValues(now)
          tone.gain.gain.setValueAtTime(gainAt(tone.envelope, now), now)
          tone.gain.gain.linearRampToValueAtTime(0, now + RELEASE_SECS)
          tone.source.stop(now + RELEASE_SECS)
        })
        if (!stopped) {
          yield* discardTone(handle.id, tone)
        } else {
          tone.releasing = true
        }
      })

    const setToneGain = (handle: ToneHandle, gain: number): Effect.Effect<void> =>
      Effect.gen(function* updateToneGain() {
        const tone = (yield* Ref.get(activeRef)).get(handle.id)
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
      Effect.map(Ref.get(activeRef), (active) => active.has(handle.id))

    const setMasterGain = (gain: number): Effect.Effect<void> =>
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
        return 'unavailable' as AudioAvailability
      }

      const {context} = runtime.value

      yield* Effect.tryPromise({
        catch: (cause) => cause,
        try: () => context.resume(),
      }).pipe(Effect.catchAll(() => Effect.void))

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
        yield* preloadSamples([request.soundId]).pipe(Effect.asVoid)
        return yield* playTone({
          durationSecs: 1,
          frequency: 20,
          gain: request.gain,
          loop: false,
          naturalDuration: true,
          pan: 0,
          playbackRate: request.playbackRate,
          sampleOnly: true,
          soundId: request.soundId,
          stream: request.stream,
        })
      })

    // No catchAllCause wrapper: `preloadAudioSamples` types its error channel
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
      const active = yield* Ref.get(activeRef)

      return {
        activeTones: active.size,
        availability: Option.match(runtime, {
          onNone: (): AudioAvailability => 'unavailable',
          onSome: (value) => availabilityForState(value.context.state),
        }),
        capacityRefusals: yield* Ref.get(capacityRefusalsRef),
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
        refusedTones: yield* Ref.get(refusedTonesRef),
        spontaneousStateChanges: yield* Ref.get(stateChangesRef),
        unlockAttempts: yield* Ref.get(unlockAttemptsRef),
        unlockRefusals: yield* Ref.get(unlockRefusalsRef),
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
      for (const tone of (yield* Ref.get(activeRef)).values()) {
        yield* ignoringFailure(() => tone.source.stop())
        yield* releaseTone(tone)
      }
      yield* Ref.set(activeRef, new Map())
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

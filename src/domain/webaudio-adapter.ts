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
  type ToneHandle,
  type ToneRequest,
} from './backend-port'
import { RELEASE_SECS, type ToneEnvelope, drivenFrequency, gainAt, toneEnvelope } from './envelope'
import { clamp01, clampPan } from './volume'
import type {
  AudioBufferSurface,
  AudioContextStateSurface,
  AudioContextSurface,
  AudioScheduledSourceSurface,
  GainSurface,
  OscillatorSurface,
  OscillatorWave,
  StereoPannerSurface,
  WebAudioGlobalSurface,
} from './webaudio-surface'

/**
 * Default for callers such as BGM that do not author an explicit waveform.
 */
export const DEFAULT_TONE_WAVE: OscillatorWave = 'sine'

/** A conservative ceiling that prevents pathological cue bursts from exhausting nodes. */
export const DEFAULT_MAX_CONCURRENT_TONES = 32

export type AudioSampleSource =
  | { readonly kind: 'array-buffer'; readonly data: ArrayBuffer }
  | { readonly kind: 'url'; readonly url: string }

export type AudioSampleManifest = Readonly<Record<string, AudioSampleSource>>

export type AudioSampleLoadReport = {
  readonly requested: number
  readonly loaded: number
  readonly cached: number
  readonly failed: number
}

/** Which spelling of the constructor the host turned out to have. */
export type WebAudioConstructorName = 'AudioContext' | 'webkitAudioContext'

export type WebAudioOptions = {
  /**
   * Where to look for a constructor. In a browser this is `globalThis`; in a
   * test it is an object; in Node it is
   * `{ AudioContext: undefined, webkitAudioContext: undefined }` — the spelling
   * `WebAudioGlobalSurface` exists to make possible, because "I checked and
   * there is none" should look different from "I forgot".
   */
  readonly global: WebAudioGlobalSurface
  /**
   * The master node's gain before any `setMasterGain` call.
   *
   * Defaults to `DEFAULT_VOLUME_SETTINGS.master`. It matters because the
   * context may be created long after the player's settings were loaded: a
   * master node that starts at 1 and is corrected on the next settings change
   * plays the first cue at full volume.
   */
  readonly initialMasterGain?: number
  /** Maximum active tones. Additional cues are discarded and reported. */
  readonly maxConcurrentTones?: number
  /** Resolves an already-decoded sample; missing/failed samples use synthesis. */
  readonly resolveAudioBuffer?: (soundId: string) => AudioBufferSurface | null
  /** Samples to decode ahead of playback. Unloaded cues retain tone fallback. */
  readonly sampleManifest?: AudioSampleManifest
  /** Host-owned URL transport, keeping fetch and DOM types outside the domain. */
  readonly loadSampleData?: (url: string) => Promise<ArrayBuffer>
}

/**
 * Everything the adapter knows about its own state, as one value.
 *
 * This type is the answer to "why could I not hear that". It exists because the
 * reference could not answer it — `docs/design-notes.md` DN-1's table has two
 * rows marked 「テストが無い」 precisely because the states they describe were
 * not represented anywhere. A field here is a question somebody asked while
 * debugging silence.
 */
export type WebAudioReport = {
  readonly availability: AudioAvailability
  /** `null` until the context is created; see `makeWebAudioBackend` on laziness. */
  readonly contextState: AudioContextStateSurface | null
  /** `null` when the host had neither constructor. */
  readonly constructorName: WebAudioConstructorName | null
  /** `false` when `createStereoPanner` was absent, i.e. sound is MONO. */
  readonly stereo: boolean
  /** `true` once construction has been attempted, successfully or not. */
  readonly contextAttempted: boolean
  /** How many times `unlock` was run. */
  readonly unlockAttempts: number
  /** How many of those left the context not running. The autoplay refusals. */
  readonly unlockRefusals: number
  /**
   * Cues the guard refused, and therefore DISCARDED. Never queued.
   * A non-zero value here with `availability: 'ready'` means the player missed
   * sounds before they clicked, which is expected and not an error.
   */
  readonly refusedTones: number
  /** Ready-state cues discarded because `maxConcurrentTones` was reached. */
  readonly capacityRefusals: number
  /** Tones currently scheduled or sounding. */
  readonly activeTones: number
  /**
   * How many times the browser changed `state` without being asked.
   *
   * The iOS interruption counter. A phone call that starts and ends while the
   * page is open moves the context to `'interrupted'` and back, and polling
   * `state` would see neither edge. Without this the report would say `ready`
   * and be right, having been wrong for the whole call.
   */
  readonly spontaneousStateChanges: number
  readonly muted: boolean
  readonly disposed: boolean
}

/**
 * The backend, plus the three things only a real one can offer.
 *
 * `unlock` is not on `AudioBackend` because no pure or recording backend has
 * anything to do with a user gesture; putting it there would oblige every fake
 * in every downstream repository to pretend to have an autoplay policy.
 */
export type WebAudioBackend = AudioBackend & {
  /** Decode configured samples. Concurrent requests for one id share one load. */
  readonly preloadSamples: (soundIds?: ReadonlyArray<string>) => Effect.Effect<AudioSampleLoadReport>
  /**
   * Run this FROM A USER GESTURE HANDLER — a click, a keydown, a touch.
   *
   * Returns the availability that resulted, and never fails. A refusal is the
   * ordinary outcome, not an exception: browsers refuse for reasons the page
   * cannot inspect (the gesture was not "activating", the tab is in the
   * background, an iOS interruption is still in force), and there is nothing to
   * do about any of them except report `locked` and let the UI say "click to
   * enable sound".
   *
   * Note it re-reads `state` AFTER `resume()` resolves rather than trusting the
   * resolution. A resolved `resume()` does not mean a running context; Safari
   * in particular resolves while still suspended. Trusting the promise is how a
   * page ends up sure it has audio and silent.
   */
  readonly unlock: Effect.Effect<AudioAvailability>
  readonly report: Effect.Effect<WebAudioReport>
  /** Mute without forgetting the configured master gain. */
  readonly setMuted: (muted: boolean) => Effect.Effect<void>
  /** Permanently release nodes and the context. Safe to call repeatedly. */
  readonly dispose: Effect.Effect<void>
  /**
   * Release the device. For tests, previews, and page teardown.
   *
   * A closed context is `unavailable`, not `locked`: no gesture revives it, and
   * reporting `locked` would leave a UI showing a "click to enable" button that
   * can never work.
   */
  readonly close: Effect.Effect<void>
}

/**
 * The state-to-availability mapping, exported because it is the load-bearing
 * decision in the file and deserves to be tested and printed on its own.
 *
 * `'interrupted'` maps to `locked`, and `domain/webaudio-surface.ts` explains
 * where that state came from. It is the right answer for the same reason
 * `'suspended'` is: a backend exists, sound is not currently reaching the
 * player, and a user gesture may fix it.
 *
 * `'closed'` maps to `unavailable` and NOT to `locked`, because a gesture will
 * not fix it. That is the distinction `locked` exists to draw.
 */
export const availabilityForState = (state: AudioContextStateSurface): AudioAvailability => {
  if (state === 'running') {
    return 'ready'
  }
  if (state === 'closed') {
    return 'unavailable'
  }
  return 'locked'
}

type ActiveTone = {
  readonly source: AudioScheduledSourceSurface
  readonly gain: GainSurface
  readonly panner: StereoPannerSurface | null
  /**
   * The curve this tone was scheduled with, kept so that `stopTone` can ramp
   * down FROM WHERE THE TONE ACTUALLY IS rather than from its peak.
   *
   * Ramping from the peak would be a step UP for a tone stopped during its
   * attack — a cancel that makes the sound briefly louder, which is the
   * opposite of what cancelling means.
   */
  readonly envelope: ToneEnvelope
}

type ContextRuntime = {
  readonly context: AudioContextSurface
  readonly master: GainSurface
  readonly constructorName: WebAudioConstructorName
  readonly stereo: boolean
}

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
    const maxConcurrentTones = Math.max(
      1,
      Math.floor(options.maxConcurrentTones ?? DEFAULT_MAX_CONCURRENT_TONES),
    )
    const activeRef = yield* Ref.make<ReadonlyMap<number, ActiveTone>>(new Map())
    const nextIdRef = yield* Ref.make(0)
    const unlockAttemptsRef = yield* Ref.make(0)
    const unlockRefusalsRef = yield* Ref.make(0)
    const refusedTonesRef = yield* Ref.make(0)
    const capacityRefusalsRef = yield* Ref.make(0)
    const stateChangesRef = yield* Ref.make(0)
    const sampleCache = new Map<string, AudioBufferSurface>()
    const sampleLoads = new Map<string, Promise<boolean>>()

    /**
     * Feature detection, as a value rather than as a global read.
     *
     * `webkitAudioContext` is checked second, so a browser with both prefers
     * the standard one. Safari before 14.1 has only the prefixed spelling, and
     * `docs/public-api.md` §7 lists it as new work: a grep for
     * `webkitAudioContext` across the whole reference implementation returns
     * nothing, so that browser had no audio at all and nobody noticed.
     */
    const findConstructor = (): Option.Option<{
      readonly construct: new () => AudioContextSurface
      readonly name: WebAudioConstructorName
    }> => {
      const standard = options.global.AudioContext
      if (standard !== undefined) {
        return Option.some({ construct: standard, name: 'AudioContext' })
      }
      const prefixed = options.global.webkitAudioContext
      if (prefixed !== undefined) {
        return Option.some({ construct: prefixed, name: 'webkitAudioContext' })
      }
      return Option.none()
    }

    const ensureRuntime: Effect.Effect<Option.Option<ContextRuntime>> = Effect.gen(function*  ensureRuntime() {
      if (yield* Ref.get(disposedRef)) {
        return Option.none<ContextRuntime>()
      }
      const cached = yield* Ref.get(runtimeRef)
      if (Option.isSome(cached)) {
        return cached
      }

      yield* Ref.set(attemptedRef, true)

      const found = findConstructor()
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
            stereo: built.createStereoPanner !== undefined,
          }
        },
      }).pipe(Effect.catchAll(() => Effect.succeed(null)))

      if (wired === null) {
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
      return runtime
    })

    const currentAvailability: Effect.Effect<AudioAvailability> = Effect.map(
      ensureRuntime,
      Option.match({
        onNone: (): AudioAvailability => 'unavailable',
        onSome: (runtime) => availabilityForState(runtime.context.state),
      }),
    )

    const releaseTone = (tone: ActiveTone): Effect.Effect<void> =>
      Effect.gen(function* releaseActiveTone() {
        yield* ignoringFailure(() => tone.source.disconnect())
        yield* ignoringFailure(() => tone.gain.disconnect())
        const {panner} = tone
        if (panner !== null) {
          // Bound to a local first: the narrowing above does not survive into
          // The closure, because `tone.panner` is a property read the compiler
          // Cannot prove is stable across the call.
          yield* ignoringFailure(() => panner.disconnect())
        }
      })

    const playTone = (request: ToneRequest): Effect.Effect<ToneHandle> =>
      Effect.gen(function* scheduleTone() {
        // The id is allocated BEFORE the gate, matching `UnavailableBackendLayer`
        // And the reference (`audio-engine.ts:40` numbers, `:42` gates). That
        // Is a trap `docs/public-api.md` §3 names and keeps on purpose, so the
        // Shape is uniform across every backend: "I got a handle" never means
        // "it played" anywhere in this repository. What is different here is
        // That the refusal is COUNTED, so the trap is at least observable.
        const id = yield* Ref.updateAndGet(nextIdRef, (value) => value + 1)
        const handle: ToneHandle = { id }

        const runtime = yield* ensureRuntime
        if (Option.isNone(runtime)) {
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          return handle
        }

        const { context, master, stereo } = runtime.value
        if (context.state !== 'running') {
          // NO RESUME HERE. This is the exact line the reference got wrong:
          // Calling `resume()` outside a user gesture is refused anyway, and
          // Swallowing that refusal is what let it build a node graph for a
          // Sound nobody could hear. Refusing early costs one counter and
          // Keeps the graph honest.
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          return handle
        }

        const envelope = toneEnvelope(request, context.currentTime)
        if (envelope.peakGain === 0) {
          return handle
        }

        if ((yield* Ref.get(activeRef)).size >= maxConcurrentTones) {
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          yield* Ref.update(capacityRefusalsRef, (count) => count + 1)
          return handle
        }

        const built = yield* Effect.try({
          catch: (cause) => cause,
          try: (): ActiveTone => {
            let source: AudioScheduledSourceSurface | null = null
            let gain: GainSurface | null = null
            let panner: StereoPannerSurface | null = null
            try {
              if (request.soundId !== undefined) {
                try {
                  const buffer = options.resolveAudioBuffer?.(request.soundId) ?? sampleCache.get(request.soundId) ?? null
                  const {createBufferSource} = context
                  if (buffer !== null && createBufferSource !== undefined) {
                    const bufferSource = createBufferSource.call(context)
                    bufferSource.buffer = buffer
                    bufferSource.loop = request.loop
                    source = bufferSource
                  }
                } catch {
                  // A sample resolver or source failure must not silence the cue.
                }
              }
              if (source === null) {
                const oscillator: OscillatorSurface = context.createOscillator()
                oscillator.type = request.wave ?? DEFAULT_TONE_WAVE
                oscillator.frequency.value = drivenFrequency(request.frequency)
                source = oscillator
              }

              gain = context.createGain()
              for (const point of envelope.points) {
                if (point.kind === 'set') {
                  gain.gain.setValueAtTime(point.gain, point.atSecs)
                } else {
                  gain.gain.linearRampToValueAtTime(point.gain, point.atSecs)
                }
              }

              source.connect(gain)

              const createPanner = context.createStereoPanner
              panner = stereo && createPanner !== undefined ? createPanner.call(context) : null

              if (panner === null) {
                gain.connect(master)
              } else {
                panner.pan.value = clampPan(request.pan)
                gain.connect(panner)
                panner.connect(master)
              }

              return { envelope, gain, panner, source }
            } catch (cause) {
              for (const node of [source, gain, panner]) {
                try {
                  node?.disconnect()
                } catch {
                  // Best-effort cleanup must not hide the graph construction failure.
                }
              }
              throw cause
            }
          },
        }).pipe(Effect.catchAll(() => Effect.succeed(null)))

        if (built === null) {
          yield* Ref.update(refusedTonesRef, (count) => count + 1)
          return handle
        }

        yield* Ref.update(activeRef, (current) => new Map(current).set(id, built))

        yield* ignoringFailure(() => {
          built.source.onended = () => {
            Effect.runSync(
              Effect.gen(function*  onended() {
                yield* releaseTone(built)
                yield* Ref.update(activeRef, (current) => {
                  const next = new Map(current)
                  next.delete(id)
                  return next
                })
              }),
            )
          }
        })

        yield* ignoringFailure(() => {
          built.source.start(envelope.startSecs)
          if (envelope.stopAtSecs !== null) {
            built.source.stop(envelope.stopAtSecs)
          }
        })

        return handle
      })

    const stopTone = (handle: ToneHandle): Effect.Effect<void> =>
      Effect.gen(function* stopActiveTone() {
        const tone = (yield* Ref.get(activeRef)).get(handle.id)
        if (tone === undefined) {
          return
        }

        const runtime = yield* Ref.get(runtimeRef)
        if (Option.isNone(runtime)) {
          return
        }

        const now = runtime.value.context.currentTime

        // Ramp down instead of stopping outright. `stopTone` is how a BGM track
        // Ends and how a looping cue is cancelled, and a loop cut mid-cycle at
        // Full amplitude is the loudest click this adapter could produce — a
        // Sustained tone is at full gain by definition, unlike a short cue
        // Which is usually already in its release when it ends.
        yield* ignoringFailure(() => {
          // `cancelScheduledValues` first, or the tone's own release — already
          // On the automation timeline from `playTone` — competes with this
          // One and the parameter jumps between the two curves.
          tone.gain.gain.cancelScheduledValues(now)
          tone.gain.gain.setValueAtTime(gainAt(tone.envelope, now), now)
          tone.gain.gain.linearRampToValueAtTime(0, now + RELEASE_SECS)
          tone.source.stop(now + RELEASE_SECS)
        })
      })

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

    const preloadSamples = (
      soundIds?: ReadonlyArray<string>,
    ): Effect.Effect<AudioSampleLoadReport> =>
      Effect.gen(function* preloadConfiguredSamples() {
        const manifest = options.sampleManifest ?? {}
        const ids = [...new Set(soundIds ?? Object.keys(manifest))]
        let loaded = 0
        let cached = 0
        let failed = 0

        for (const soundId of ids) {
          if (sampleCache.has(soundId)) {
            cached += 1
          } else {
            const source = manifest[soundId]
            if (source === undefined) {
              failed += 1
            } else {
              let pending = sampleLoads.get(soundId)
              if (pending === undefined) {
                pending = Effect.runPromise(
                  Effect.gen(function* loadSample() {
                    const runtime = yield* ensureRuntime
                    if (Option.isNone(runtime) || (yield* Ref.get(disposedRef))) {
                      return false
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
                      return false
                    }
                    const decoded = yield* Effect.tryPromise({
                      catch: (cause) => cause,
                      try: () => runtime.value.context.decodeAudioData(data),
                    }).pipe(Effect.catchAll(() => Effect.succeed(null)))
                    if (decoded === null || (yield* Ref.get(disposedRef))) {
                      return false
                    }
                    sampleCache.set(soundId, decoded)
                    return true
                  }),
                ).finally(() => sampleLoads.delete(soundId))
                sampleLoads.set(soundId, pending)
              }
              if (yield* Effect.promise(() => pending)) {
                loaded += 1
              } else {
                failed += 1
              }
            }
          }
        }
        return { cached, failed, loaded, requested: ids.length }
      })

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
        stereo: Option.match(runtime, {
          onNone: () => false,
          onSome: (value) => value.stereo,
        }),
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
        return
      }
      for (const tone of (yield* Ref.get(activeRef)).values()) {
        yield* ignoringFailure(() => tone.source.stop())
        yield* releaseTone(tone)
      }
      yield* Ref.set(activeRef, new Map())
      sampleCache.clear()
      yield* Effect.tryPromise({
        catch: (cause) => cause,
        try: () => runtime.value.context.close(),
      }).pipe(Effect.catchAll(() => Effect.void))
    })

    return {
      availability: currentAvailability,
      close: dispose,
      dispose,
      playTone,
      preloadSamples,
      report,
      setMasterGain,
      setMuted,
      stopTone,
      unlock,
    }
  })

/**
 * The adapter as a Layer, for a host that only needs `AudioBackendPort`.
 *
 * Note what this DISCARDS: `unlock`, `report` and `close` are not on
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
        playTone: backend.playTone,
        setMasterGain: backend.setMasterGain,
        stopTone: backend.stopTone,
      }),
    ),
  )

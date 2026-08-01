/* oxlint-disable */
/**
 * `AudioBackendPort` — the only place WebAudio is allowed to exist.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * Everything else in mc-audio is pure and runs in Node with no DOM, enforced by
 * `tsconfig.base.json`, whose `lib` does not include `"DOM"`.
 *
 * The adapter now exists — `domain/webaudio-adapter.ts` — and `lib` STILL does
 * not include `"DOM"`, which is not what the first cut of this comment
 * predicted. It said the adapter would bring its own tsconfig with `"DOM"` in
 * it; that turned out to be the wrong move, for a mechanical reason mc-save hit
 * first: `scripts/api-lock.ts` and `scripts/check-dependency-whitelist.ts` both
 * scan `tsconfig.build.json`, so an adapter outside it would be the one file
 * that talks to real hardware and the one file no gate can see. Instead
 * `domain/webaudio-surface.ts` describes the Web Audio members structurally and
 * a test compiles a fixture against the real `lib.dom.d.ts` to prove the
 * description is true.
 *
 * ---------------------------------------------------------------------------
 * `availability` is a first-class value, and that is the point
 * ---------------------------------------------------------------------------
 *
 * The reference implementation had three separate ways for a sound not to play
 * and no way to tell them apart:
 *
 *  1. the settings gate — `packages/game/application/sound-manager-playback.ts:19-21`
 *  2. no AudioContext at all — `packages/game/infrastructure/audio-engine.ts:42-44`,
 *     which returns a valid `ToneHandle` for a sound that will never exist
 *  3. the browser's autoplay policy — `audio-engine.ts:46-49`, a `context.resume()`
 *     whose rejection is swallowed by `Effect.catchAllCause(() => Effect.void)`
 *
 * Case 3 is the interesting one. There is no user-gesture unlock, no "unlocked"
 * flag, no pending-cue queue and no `webkitAudioContext` fallback anywhere in
 * that repository — a grep for `webkitAudioContext|autoplay|userGesture|unlock`
 * returns nothing. So when the browser refused, the code went on to build
 * oscillator nodes that never audibly sounded, and nothing above could observe
 * that.
 *
 * Making availability observable is what lets the caption stream label its
 * events `gate-blocked` rather than `audible`, and lets a UI say "click to
 * enable sound" instead of appearing broken.
 */
import { Context, Effect, Layer, Ref } from 'effect'

/**
 * - `unavailable` — no backend exists (Node, SSR, a browser without WebAudio).
 * - `locked` — a backend exists but the browser has not permitted playback yet.
 *   Requires a user gesture. This is the state the reference could not represent.
 * - `ready` — sound will actually be heard.
 */
export const AUDIO_AVAILABILITIES = ['unavailable', 'locked', 'ready'] as const

export type AudioAvailability = (typeof AUDIO_AVAILABILITIES)[number]

export type ToneRequest = {
  readonly soundId?: string
  readonly frequency: number
  /** Oscillator waveform; cue authoring may override the sine default. */
  readonly wave?: 'sine' | 'square' | 'sawtooth' | 'triangle'
  /** Seconds. Inert when `loop` is true. */
  readonly durationSecs: number
  /** Final per-tone gain in [0, 1]. Master is NOT included — see domain/volume.ts. */
  readonly gain: number
  /** Stereo position in [-1, 1]. */
  readonly pan: number
  readonly loop: boolean
}

export type ToneHandle = {
  readonly id: number
}

export type AudioBackend = {
  readonly availability: Effect.Effect<AudioAvailability>
  readonly playTone: (request: ToneRequest) => Effect.Effect<ToneHandle>
  readonly stopTone: (handle: ToneHandle) => Effect.Effect<void>
  /**
   * Set the single master gain node. Called once per settings change, never
   * per cue — see `domain/volume.ts` on why master is applied exactly once.
   */
  readonly setMasterGain: (gain: number) => Effect.Effect<void>
}

export class AudioBackendPort extends Context.Tag('@nerima-games/mc-audio/AudioBackendPort')<
  AudioBackendPort,
  AudioBackend
>() {}

export type RecordedBackend = {
  readonly backend: AudioBackend
  /** Every tone the engine asked for, in order. */
  readonly played: Effect.Effect<ReadonlyArray<ToneRequest>>
  readonly masterGains: Effect.Effect<ReadonlyArray<number>>
}

/**
 * A backend that records instead of making noise, at a chosen availability.
 *
 * Shipped from `domain/` rather than from a test helper because the contract it
 * embodies — "a `locked` backend is never asked to play" — is a property of
 * mc-audio that downstream repositories must also be able to test against.
 */
export const makeRecordingBackend = (
  availability: AudioAvailability,
): Effect.Effect<RecordedBackend> =>
  Effect.gen(function*  makeRecordingBackend() {
    const requests = yield* Ref.make<ReadonlyArray<ToneRequest>>([])
    const gains = yield* Ref.make<ReadonlyArray<number>>([])
    const nextId = yield* Ref.make(0)

    const backend: AudioBackend = {
      availability: Effect.succeed(availability),
      playTone: (request) =>
        Effect.gen(function*  playTone() {
          yield* Ref.update(requests, (current) => [...current, request])
          const id = yield* Ref.updateAndGet(nextId, (value) => value + 1)
          return { id }
        }),
      setMasterGain: (gain) => Ref.update(gains, (current) => [...current, gain]),
      stopTone: () => Effect.void,
    }

    return {
      backend,
      masterGains: Ref.get(gains),
      played: Ref.get(requests),
    }
  })

/**
 * The backend used when there is none: Node, a test, a server render.
 *
 * Note that it still answers `playTone` with a handle. A caller must never
 * branch on "did I get a handle" to decide whether sound happened — that was
 * exactly the reference implementation's trap (`audio-engine.ts:40` assigns the
 * id before the context gate at `:42`, so ids stayed monotonic even with no
 * audio at all). Branch on `availability`.
 */
export const UnavailableBackendLayer: Layer.Layer<AudioBackendPort> = Layer.succeed(AudioBackendPort, {
  availability: Effect.succeed<AudioAvailability>('unavailable'),
  playTone: () => Effect.succeed({ id: 0 }),
  setMasterGain: () => Effect.void,
  stopTone: () => Effect.void,
})

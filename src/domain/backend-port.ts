/* oxlint-disable new-cap, no-magic-numbers -- Effect.Tag is a callable class factory; zero/one are the recorder counter's identity and increment. */
/**
 * `AudioBackendPort` — the only place WebAudio is allowed to exist.
 *
 * Boundary and provenance notes.
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
 * flag and no pending-cue queue anywhere in that repository — a grep for
 * `autoplay|userGesture|unlock` returns nothing. So when the browser refused, the code went on to build
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
  /** Positive playback multiplier for decoded samples; oscillator frequency is unchanged. */
  readonly playbackRate?: number
  readonly frequency: number
  /** Oscillator waveform; cue authoring may override the sine default. */
  readonly wave?: 'sine' | 'square' | 'sawtooth' | 'triangle'
  /** Seconds. Inert when `loop` or `naturalDuration` is true. */
  readonly durationSecs: number
  /** Final finite, non-negative per-tone gain. Master is NOT included — see domain/volume.ts. */
  readonly gain: number
  /** Stereo position in [-1, 1]. */
  readonly pan: number
  readonly loop: boolean
  /** Prefer the host's streaming source factory; fall back to a decoded sample when available. */
  readonly stream?: boolean
  /** Let the sample or stream decide when playback ends instead of scheduling a tone stop. */
  readonly naturalDuration?: boolean
  /** Refuse oscillator fallback when this request names an asset that must exist. */
  readonly sampleOnly?: boolean
}

export type MusicRequest = {
  /** A decoded or streamed Minecraft sound id supplied by the host manifest. */
  readonly soundId: string
  /** Initial gain before master volume is applied. */
  readonly gain: number
  /** Playback-rate multiplier resolved from the Minecraft sound variant. */
  readonly playbackRate: number
  /** Whether the Minecraft sound variant requests a streaming source. */
  readonly stream: boolean
}

export type ToneHandle = {
  readonly id: number
}

/**
 * The backend handle plus the admission result for this playback request.
 * A handle is allocated before all backends can know whether a request will be
 * audible, so callers must inspect `accepted` rather than infer success from
 * the presence of an id.
 */
export type TonePlayback = ToneHandle & {
  readonly accepted: boolean
}

export type AudioBackend = {
  readonly availability: Effect.Effect<AudioAvailability>
  readonly playTone: (request: ToneRequest) => Effect.Effect<TonePlayback>
  readonly playMusic: (request: MusicRequest) => Effect.Effect<TonePlayback>
  readonly stopTone: (handle: ToneHandle) => Effect.Effect<void>
  readonly setToneGain: (handle: ToneHandle, gain: number) => Effect.Effect<void>
  readonly isToneActive: (handle: ToneHandle) => Effect.Effect<boolean>
  /**
   * Set the single master gain node. Called once per settings change, never
   * per cue — see `domain/volume.ts` on why master is applied exactly once.
   */
  readonly setMasterGain: (gain: number) => Effect.Effect<void>
}

const AudioBackendPortBase: Context.TagClass<
  AudioBackendPort,
  '@nerima-games/mc-audio/AudioBackendPort',
  AudioBackend
> = Context.Tag('@nerima-games/mc-audio/AudioBackendPort')<AudioBackendPort, AudioBackend>()

export class AudioBackendPort extends AudioBackendPortBase {}

export type RecordedBackend = {
  readonly backend: AudioBackend
  /** Every tone the engine asked for, in order. */
  readonly played: Effect.Effect<ReadonlyArray<ToneRequest>>
  /** Every music track the music manager asked for, in order. */
  readonly musicPlayed: Effect.Effect<ReadonlyArray<MusicRequest>>
  /** Every per-tone gain update, in order. */
  readonly toneGains: Effect.Effect<ReadonlyArray<{ readonly handle: ToneHandle; readonly gain: number }>>
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
  Effect.gen(function* buildRecordingBackend() {
    const requests = yield* Ref.make<ReadonlyArray<ToneRequest>>([])
    const musicRequests = yield* Ref.make<ReadonlyArray<MusicRequest>>([])
    const toneGainChanges = yield* Ref.make<ReadonlyArray<{ readonly handle: ToneHandle; readonly gain: number }>>([])
    const gains = yield* Ref.make<ReadonlyArray<number>>([])
    const nextId = yield* Ref.make(0)
    const activeIds = yield* Ref.make<ReadonlySet<number>>(new Set())
    const accepted = availability === 'ready'

    const backend: AudioBackend = {
      availability: Effect.succeed(availability),
      isToneActive: (handle) => Effect.map(Ref.get(activeIds), (current) => current.has(handle.id)),
      playMusic: (request) =>
        Effect.gen(function* playMusic() {
          yield* Ref.update(musicRequests, (current) => [...current, request])
          const id = yield* Ref.updateAndGet(nextId, (value) => value + 1)
          if (accepted) {
            yield* Ref.update(activeIds, (current) => new Set(current).add(id))
          }
          return { accepted, id }
        }),
      playTone: (request) =>
        Effect.gen(function*  playTone() {
          yield* Ref.update(requests, (current) => [...current, request])
          const id = yield* Ref.updateAndGet(nextId, (value) => value + 1)
          if (accepted) {
            yield* Ref.update(activeIds, (current) => new Set(current).add(id))
          }
          return { accepted, id }
        }),
      setMasterGain: (gain) => Ref.update(gains, (current) => [...current, gain]),
      setToneGain: (handle, gain) =>
        Ref.update(toneGainChanges, (current) => [...current, { gain, handle }]),
      stopTone: (handle) => Ref.update(activeIds, (current) => {
        const next = new Set(current)
        next.delete(handle.id)
        return next
      }),
    }

    return {
      backend,
      masterGains: Ref.get(gains),
      musicPlayed: Ref.get(musicRequests),
      played: Ref.get(requests),
      toneGains: Ref.get(toneGainChanges),
    }
  })

/**
 * The backend used when there is none: Node, a test, a server render.
 *
 * Note that it still answers `playTone` with a handle-shaped value so the port
 * stays total. Its `accepted` flag is false, which prevents callers from
 * reporting a refused request as audible playback.
 */
export const UnavailableBackendLayer: Layer.Layer<AudioBackendPort> = Layer.succeed(AudioBackendPort, {
  availability: Effect.succeed<AudioAvailability>('unavailable'),
  isToneActive: () => Effect.succeed(false),
  playMusic: () => Effect.succeed({ accepted: false, id: 0 }),
  playTone: () => Effect.succeed({ accepted: false, id: 0 }),
  setMasterGain: () => Effect.void,
  setToneGain: () => Effect.void,
  stopTone: () => Effect.void,
})

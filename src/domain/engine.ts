/* oxlint-disable new-cap, no-ternary, no-undefined, sort-imports -- Effect.Tag is callable; optional WebAudio inputs require explicit undefined checks and compact conditional object construction. */
/**
 * `SoundCuePort` — and the ordering that this whole repository exists to protect.
 *
 * Boundary and provenance notes.
 *
 * ---------------------------------------------------------------------------
 * THE INVARIANT: captions are emitted BEFORE the audio gate is consulted
 * ---------------------------------------------------------------------------
 *
 * A caption must appear even when the sound cannot play. Not "usually", not
 * "when audio is merely muted" — always, including when the browser's autoplay
 * policy has blocked the AudioContext and when there is no audio backend at
 * all. Captions exist for players who cannot hear or who play muted; gating
 * them on audio being available hides them from exactly the people they serve.
 *
 * The reference implementation got this right and said so, at
 * `packages/game/application/sound-manager.ts:43-48`:
 *
 *     // Captions fire BEFORE the audio-enabled gate on purpose: they exist
 *     // for players who play muted or can't hear — gating them on audio
 *     // being on would hide them from exactly the users they serve.
 *     yield* captions.announce(effect)            // line 48
 *     const enabled = yield* Ref.get(enabledRef)  // line 49
 *
 * and pinned it with a test at
 * `packages/game/test/sound-manager.test.ts:230-241` — "announces captions even
 * while audio is disabled (hearing accessibility)".
 *
 * ---------------------------------------------------------------------------
 * ...but it only pinned ONE of the three gates
 * ---------------------------------------------------------------------------
 *
 * That test provides a fake engine and flips the settings gate. The other two
 * gates were never covered: `packages/game/infrastructure/audio-engine.ts` and
 * `audio-context-helpers.ts` have no tests at all — nothing in that repository
 * ever constructs an AudioContext or exercises the missing-context path
 * (`audio-engine.ts:42-44`) or the autoplay `resume()` path (`:46-49`).
 *
 * So the invariant held for `audioEnabled: false` and was merely *probably*
 * true for a browser that blocks autoplay — which is the case that affects every
 * player on their first visit, before they have clicked anything.
 *
 * `test/caption-gate.test.ts` covers all three. That is the single most
 * important test in this repository.
 */
import { ClockPort, type Position } from '@nerima-games/mc-kernel'
import { Context, Effect, Layer, Option } from 'effect'
import { type AudioAvailability, AudioBackendPort, type ToneRequest } from './backend-port.js'
import { type CaptionEvent, type CaptionReason, CaptionStream } from './caption.js'
import { type CuePlayOptions, type SoundCueId, cueDefinition } from './cue.js'
import {
  NO_SPATIALISATION,
  type VolumeSettings,
  effectiveSfxGain,
  spatialise,
} from './volume.js'

export type CueContext = {
  readonly settings: VolumeSettings
  /** The player's audio on/off switch. Distinct from availability. */
  readonly enabled: boolean
  readonly availability: AudioAvailability
  readonly listener: Position
  /** Horizontal look direction. Omit to retain world +X as stereo right. */
  readonly listenerForward?: Position
}

/**
 * The whole decision, as a pure function.
 *
 * Splitting the decision from the effect is what makes the ordering invariant
 * checkable by inspection: `caption` is computed unconditionally, and `tone` is
 * the only field that any gate can suppress. The reference had the same split
 * for its playback planner (`sound-manager-playback.ts:11-18`), but the caption
 * was not part of it — it lived in the effectful wrapper, so the relationship
 * between the two was expressed only by statement order.
 */
export type CuePlan = {
  /** `null` only when the cue is deliberately uncaptioned, never because of a gate. */
  readonly caption: Omit<CaptionEvent, 'atSecs'> | null
  readonly tone: ToneRequest | null
}

const reasonFor = (context: CueContext): CaptionReason => {
  if (!context.enabled) {
    return 'muted'
  }
  if (context.availability === 'unavailable') {
    return 'unavailable'
  }
  if (context.availability === 'locked') {
    return 'gate-blocked'
  }
  return 'audible'
}

export const planCue = (
  cueId: SoundCueId,
  context: CueContext,
  options?: CuePlayOptions,
): CuePlan => {
  const definition = cueDefinition(cueId)
  const reason = reasonFor(context)

  const spatialisation =
    definition.spatial && options?.position !== undefined
      ? spatialise(context.listener, options.position, {
          listenerForward: context.listenerForward,
        })
      : NO_SPATIALISATION

  const caption =
    definition.caption === null
      ? null
      : {
          cueId,
          reason,
          text: definition.caption,
          ...(definition.spatial ? { pan: spatialisation.pan } : {}),
        }

  if (reason !== 'audible') {
    return { caption, tone: null }
  }

  return {
    caption,
    tone: {
      durationSecs: definition.durationSecs,
      frequency: definition.frequency,
      gain: effectiveSfxGain({
        baseGain: definition.baseGain,
        sfxVolume: context.settings.sfx,
        spatialGain: spatialisation.gain,
        ...(options?.gainScale === undefined ? {} : { gainScale: options.gainScale }),
      }),
      loop: false,
      pan: spatialisation.pan,
      soundId: cueId,
      wave: definition.wave,
    },
  }
}

export type SoundCueService = {
  readonly play: (cueId: SoundCueId, options?: CuePlayOptions) => Effect.Effect<void>
}

const SoundCuePortBase: Context.TagClass<
  SoundCuePort,
  '@nerima-games/mc-audio/SoundCuePort',
  SoundCueService
> = Context.Tag('@nerima-games/mc-audio/SoundCuePort')<SoundCuePort, SoundCueService>()

export class SoundCuePort extends SoundCuePortBase {}

/**
 * Build the cue service.
 *
 * Caption timestamps come from mc-kernel's monotonic clock. The service captures
 * the clock port when it is built, keeping each returned `play` effect
 * environment-free and deterministic under a fixed clock.
 */
export const makeSoundCueService = (input: {
  readonly context: Effect.Effect<CueContext>
}): Effect.Effect<SoundCueService, never, AudioBackendPort | CaptionStream | ClockPort> =>
  Effect.gen(function* buildSoundCueService() {
    const backend = yield* AudioBackendPort
    const captions = yield* CaptionStream
    const clock = yield* ClockPort

    return {
      play: (cueId, options) =>
        Effect.gen(function* play() {
          const context = yield* input.context
          const plan = planCue(cueId, context, options)

          // ────────────────────────────────────────────────────────────────
          // THE ORDERING. The caption goes out here, before anything below
          // This line can decide not to make a sound. Do not move it.
          // See the module header and test/caption-gate.test.ts.
          // ────────────────────────────────────────────────────────────────
          if (plan.caption !== null) {
            const atSecs = yield* clock.monotonicSecs
            yield* captions.emit({ ...plan.caption, atSecs })
          }

          if (plan.tone === null) {
            return
          }

          yield* backend.playTone(plan.tone)
        }),
    }
  })

/**
 * Read the current availability from the backend, for callers assembling a
 * `CueContext`. A named helper so that "ask the backend, do not guess" has a
 * single spelling.
 */
export const currentAvailability: Effect.Effect<AudioAvailability, never, AudioBackendPort> =
  Effect.flatMap(AudioBackendPort, (backend) => backend.availability)

/** Collects caption events into a `Ref`, for tests and for non-DOM consumers. */
export const recordingCaptionLayer = (
  sink: (event: CaptionEvent) => Effect.Effect<void>,
): Layer.Layer<CaptionStream> => Layer.succeed(CaptionStream, { emit: sink })

/**
 * The first caption recorded for a cue, if any.
 *
 * A helper rather than an inline `find` because asserting "a caption was
 * emitted for this cue" is the single most repeated assertion in this
 * repository's tests, and `Option` makes the absent case explicit at the call
 * site instead of yielding `undefined` into a `.reason` access.
 */
export const firstCaptionFor = (
  events: ReadonlyArray<CaptionEvent>,
  cueId: SoundCueId,
): Option.Option<CaptionEvent> => Option.fromNullable(events.find((event) => event.cueId === cueId))

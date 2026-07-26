/**
 * `SoundCuePort` — and the ordering that this whole repository exists to protect.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
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
import { Context, Effect, Layer, Option } from 'effect'
import { AudioBackendPort, type AudioAvailability, type ToneRequest } from './backend-port'
import { CaptionStream, type CaptionEvent, type CaptionReason } from './caption'
import { cueDefinition, type CuePlayOptions, type SoundCueId } from './cue'
import {
  effectiveSfxGain,
  NO_SPATIALISATION,
  spatialise,
  type Vec3,
  type VolumeSettings,
} from './volume'

/** Base frequency per cue. Placeholder synthesis until sample assets land. */
const CUE_FREQUENCY: Record<SoundCueId, number> = {
  blockBreak: 220,
  blockPlace: 262,
  playerHurt: 165,
  itemPickup: 523,
  levelUp: 659,
  footstepGrass: 180,
  footstepStone: 200,
  inventoryOpen: 392,
  inventoryClose: 349,
}

const CUE_DURATION_SECS = 0.07

export type CueContext = {
  readonly settings: VolumeSettings
  /** The player's audio on/off switch. Distinct from availability. */
  readonly enabled: boolean
  readonly availability: AudioAvailability
  readonly listener: Vec3
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
      ? spatialise(context.listener, options.position)
      : NO_SPATIALISATION

  const caption =
    definition.caption === null
      ? null
      : {
          cueId,
          text: definition.caption,
          reason,
          ...(definition.spatial ? { pan: spatialisation.pan } : {}),
        }

  if (reason !== 'audible') {
    return { caption, tone: null }
  }

  return {
    caption,
    tone: {
      frequency: CUE_FREQUENCY[cueId],
      durationSecs: CUE_DURATION_SECS,
      gain: effectiveSfxGain({
        baseGain: definition.baseGain,
        sfxVolume: context.settings.sfx,
        spatialGain: spatialisation.gain,
        ...(options?.gainScale === undefined ? {} : { gainScale: options.gainScale }),
      }),
      pan: spatialisation.pan,
      loop: false,
    },
  }
}

export type SoundCueService = {
  readonly play: (cueId: SoundCueId, options?: CuePlayOptions) => Effect.Effect<void>
}

export class SoundCuePort extends Context.Tag('@nerima-games/mc-audio/SoundCuePort')<
  SoundCuePort,
  SoundCueService
>() {}

/**
 * Build the cue service.
 *
 * `nowSecs` is a parameter rather than a `ClockPort` dependency because mc-audio
 * cannot yet import `@nerima-games/mc-kernel` — nothing is published (plan.md §6
 * Step 0 defers publishing until the interfaces settle). When kernel is
 * consumable this becomes `ClockPort.monotonicSecs` and this parameter goes
 * away. It is a monotonic reading in seconds, never a wall clock and never
 * `performance.now()`: a caption log has to be reproducible in a replay.
 */
export const makeSoundCueService = (input: {
  readonly context: Effect.Effect<CueContext>
  readonly nowSecs: Effect.Effect<number>
}): Effect.Effect<SoundCueService, never, AudioBackendPort | CaptionStream> =>
  Effect.gen(function* () {
    const backend = yield* AudioBackendPort
    const captions = yield* CaptionStream

    return {
      play: (cueId, options) =>
        Effect.gen(function* () {
          const context = yield* input.context
          const plan = planCue(cueId, context, options)

          // ────────────────────────────────────────────────────────────────
          // THE ORDERING. The caption goes out here, before anything below
          // this line can decide not to make a sound. Do not move it.
          // See the module header and test/caption-gate.test.ts.
          // ────────────────────────────────────────────────────────────────
          if (plan.caption !== null) {
            const atSecs = yield* input.nowSecs
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

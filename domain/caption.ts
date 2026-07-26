/**
 * The caption event stream.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * This is a real stream, and the reference's was not
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.6 calls for a `CaptionEventStream` that the UI subscribes to. The
 * reference implementation had no such thing. `SoundCaptionPort`
 * (`packages/game/application/sound-caption-port.ts:8-15`) was a single method,
 * `announce(effect: SoundEffect) => Effect<void, never>`, carrying the bare cue
 * id — no timestamp, no position, no volume. It was a fire-and-forget sink, and
 * there is no `Stream` or `PubSub` anywhere in that repository's audio layer.
 *
 * Everything a caption consumer needs therefore ended up in DOM code:
 * `packages/presentation/hud/sound-captions.ts` owns the dedupe-by-label
 * (`:66-70`), the five-row cap (`:72-76`), and the 2500 ms expiry (`:6`, `:82`)
 * — using module-level mutable state (`let captionsEnabled`, `const activeRows`,
 * `:33-34`) and raw `setTimeout`. None of that is testable without a DOM, and
 * none of it is reusable by a non-DOM consumer such as a subtitle exporter or a
 * screen-reader bridge.
 *
 * Putting a timestamp on the event is what moves that logic out of the DOM: with
 * `at`, expiry and dedupe become pure functions of the event list, and the DOM
 * layer goes back to being a renderer.
 */
import { Context, Effect } from 'effect'
import type { SoundCueId } from './cue'

/**
 * Why a caption was emitted, which is what makes the accessibility contract
 * observable rather than merely intended.
 *
 * - `audible`      — the sound is actually being played.
 * - `muted`        — the player turned audio off. The caption still fires.
 * - `gate-blocked` — the browser will not let audio start yet (no user gesture).
 *   The caption still fires. This is the case the reference had no name for.
 * - `unavailable`  — no audio backend exists at all (headless, SSR, tests).
 *   The caption still fires.
 */
export const CAPTION_REASONS = ['audible', 'muted', 'gate-blocked', 'unavailable'] as const

export type CaptionReason = (typeof CAPTION_REASONS)[number]

export type CaptionEvent = {
  readonly cueId: SoundCueId
  readonly text: string
  /**
   * Monotonic seconds, from the clock Port. Never a wall clock, and never
   * `performance.now()` — a caption list must be reproducible in a replay.
   */
  readonly atSecs: number
  readonly reason: CaptionReason
  /** Present only for spatialised cues, so a UI can show a direction indicator. */
  readonly pan?: number
}

export type CaptionSink = {
  readonly emit: (event: CaptionEvent) => Effect.Effect<void>
}

export class CaptionStream extends Context.Tag('@nerima-games/mc-audio/CaptionStream')<
  CaptionStream,
  CaptionSink
>() {}

/**
 * How long a caption stays on screen. `CAPTION_DISPLAY_MS = 2500` in
 * `packages/presentation/hud/sound-captions.ts:6`, converted to seconds
 * because every duration in this project is seconds unless it says otherwise.
 */
export const CAPTION_DISPLAY_SECS = 2.5

/** `MAX_CAPTION_ROWS = 5`, `packages/presentation/hud/sound-captions.ts:7`. */
export const MAX_VISIBLE_CAPTIONS = 5

/**
 * The visible caption list at a given instant: pure, and therefore testable
 * without a DOM or fake timers.
 *
 * Deduplication is by caption *text*, not by cue id — `footstepGrass` and
 * `footstepStone` both read "Footsteps", and showing two identical rows would
 * be noise. The reference keyed its active rows by label for the same reason
 * (`sound-captions.ts:34`); the difference is that it did so in a mutable `Map`
 * inside the DOM layer.
 */
export const visibleCaptions = (
  events: ReadonlyArray<CaptionEvent>,
  nowSecs: number,
): ReadonlyArray<CaptionEvent> => {
  const live = events.filter((event) => nowSecs - event.atSecs < CAPTION_DISPLAY_SECS && nowSecs >= event.atSecs)

  // Latest occurrence of each distinct text wins, so a repeated cue refreshes
  // its row rather than stacking a second one.
  const latestByText = new Map<string, CaptionEvent>()
  for (const event of live) {
    const existing = latestByText.get(event.text)
    if (existing === undefined || event.atSecs >= existing.atSecs) {
      latestByText.set(event.text, event)
    }
  }

  return [...latestByText.values()]
    .sort((left, right) => left.atSecs - right.atSecs)
    .slice(-MAX_VISIBLE_CAPTIONS)
}

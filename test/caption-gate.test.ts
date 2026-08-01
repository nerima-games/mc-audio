import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import {
  type AudioAvailability,
  AudioBackendPort,
  type ToneRequest,
  makeRecordingBackend,
} from '../src/domain/backend-port'
import { type CaptionEvent, CaptionStream } from '../src/domain/caption'
import { type CueContext, makeSoundCueService, planCue } from '../src/domain/engine'
import { DEFAULT_VOLUME_SETTINGS } from '../src/domain/volume'

/**
 * ---------------------------------------------------------------------------
 * The most important test file in this repository.
 * ---------------------------------------------------------------------------
 *
 * The invariant: a caption is emitted for every captioned cue, regardless of
 * whether the sound can actually be heard. There are three independent reasons
 * a sound may not play, and all three must leave captions untouched:
 *
 *   1. the player muted audio                    → reason 'muted'
 *   2. the browser's autoplay policy blocks it   → reason 'gate-blocked'
 *   3. there is no audio backend at all          → reason 'unavailable'
 *
 * The reference implementation pinned only (1)
 * (`packages/game/test/sound-manager.test.ts:230-241`). Its
 * `audio-engine.ts` and `audio-context-helpers.ts` — where (2) and (3) live —
 * have no tests whatsoever, so the case that affects every player on their
 * first visit was never verified.
 */

const LISTENER = { x: 0, y: 64, z: 0 }

const baseContext = (overrides: Partial<CueContext>): CueContext => ({
  availability: 'ready',
  enabled: true,
  listener: LISTENER,
  settings: DEFAULT_VOLUME_SETTINGS,
  ...overrides,
})

type Harness = {
  readonly captions: ReadonlyArray<CaptionEvent>
  readonly tones: ReadonlyArray<ToneRequest>
}

/**
 * Runs one cue through the real service with a recording backend and a
 * recording caption sink.
 *
 * Deliberately exercises `makeSoundCueService`, not `planCue`: the ordering
 * invariant is a property of the effectful pipeline, and a test that only
 * checked the pure planner would keep passing if someone moved the caption emit
 * below the gate.
 */
const runCue = (context: CueContext, availability: AudioAvailability): Effect.Effect<Harness> =>
  Effect.gen(function*  runCue() {
    const recorded = yield* makeRecordingBackend(availability)
    const captionLog = yield* Ref.make<ReadonlyArray<CaptionEvent>>([])

    const layers = Layer.merge(
      Layer.succeed(AudioBackendPort, recorded.backend),
      Layer.succeed(CaptionStream, {
        emit: (event) => Ref.update(captionLog, (current) => [...current, event]),
      }),
    )

    const service = yield* makeSoundCueService({
      context: Effect.succeed(context),
      nowSecs: Effect.succeed(10),
    }).pipe(Effect.provide(layers))

    yield* service.play('blockBreak', { position: { x: 3, y: 64, z: 0 } })

    return {
      captions: yield* Ref.get(captionLog),
      tones: yield* recorded.played,
    }
  })

describe('captions fire ahead of the audio gate', () => {
  it.effect('gate 1 — the player muted audio: caption yes, sound no', () =>
    Effect.gen(function* () {
      const { captions, tones } = yield* runCue(baseContext({ enabled: false }), 'ready')

      expect(tones).toHaveLength(0)
      expect(captions).toHaveLength(1)
      expect(captions[0]?.cueId).toBe('blockBreak')
      expect(captions[0]?.text).toBe('Block breaks')
      expect(captions[0]?.reason).toBe('muted')
    }),
  )

  /**
   * REGRESSION — the case the reference never tested.
   *
   * On a first page visit the browser has not seen a user gesture, so the
   * AudioContext is suspended. The reference called `context.resume()` and
   * swallowed the rejection (`audio-engine.ts:46-49`), then went on to build
   * oscillator nodes that never sounded. Nothing above could tell. Here the
   * state is named, the caption still fires, and the caption says why.
   */
  it.effect('gate 2 — the browser autoplay policy has not been satisfied: caption yes, sound no', () =>
    Effect.gen(function* () {
      const { captions, tones } = yield* runCue(baseContext({ availability: 'locked' }), 'locked')

      expect(tones).toHaveLength(0)
      expect(captions).toHaveLength(1)
      expect(captions[0]?.reason).toBe('gate-blocked')
    }),
  )

  it.effect('gate 3 — no audio backend exists at all: caption yes, sound no', () =>
    Effect.gen(function* () {
      const { captions, tones } = yield* runCue(baseContext({ availability: 'unavailable' }), 'unavailable')

      expect(tones).toHaveLength(0)
      expect(captions).toHaveLength(1)
      expect(captions[0]?.reason).toBe('unavailable')
    }),
  )

  it.effect('when everything is available, the caption fires AND the sound plays', () =>
    Effect.gen(function* () {
      const { captions, tones } = yield* runCue(baseContext({}), 'ready')

      expect(tones).toHaveLength(1)
      expect(captions).toHaveLength(1)
      expect(captions[0]?.reason).toBe('audible')
    }),
  )

  it.effect('an uncaptioned cue stays uncaptioned — a null caption is authorial, not a gate', () =>
    Effect.sync(() => {
      const plan = planCue('inventoryOpen', baseContext({}))
      expect(plan.caption).toBeNull()
      expect(plan.tone).not.toBeNull()

      // ...and it stays null when muted too, i.e. the two reasons for silence
      // Never get confused with each other.
      const muted = planCue('inventoryOpen', baseContext({ enabled: false }))
      expect(muted.caption).toBeNull()
      expect(muted.tone).toBeNull()
    }),
  )
})

describe('planCue', () => {
  it.effect('suppresses the tone but never the caption, for every non-ready state', () =>
    Effect.sync(() => {
      const states: ReadonlyArray<Partial<CueContext>> = [
        { enabled: false },
        { availability: 'locked' },
        { availability: 'unavailable' },
      ]

      for (const state of states) {
        const plan = planCue('playerHurt', baseContext(state))
        expect(plan.tone).toBeNull()
        expect(plan.caption).not.toBeNull()
      }
    }),
  )

  it.effect('carries pan on a spatial cue so a caption can show a direction', () =>
    Effect.sync(() => {
      const right = planCue('blockBreak', baseContext({}), { position: { x: 12, y: 64, z: 0 } })
      const left = planCue('blockBreak', baseContext({}), { position: { x: -12, y: 64, z: 0 } })

      expect(right.caption?.pan).toBeGreaterThan(0)
      expect(left.caption?.pan).toBeLessThan(0)
    }),
  )

  it.effect('omits pan on a non-spatial cue rather than reporting a misleading zero', () =>
    Effect.sync(() => {
      const plan = planCue('levelUp', baseContext({}), { position: { x: 50, y: 64, z: 0 } })

      expect(plan.caption?.pan).toBeUndefined()
      // A UI sound is not in the world, so a position must not move it.
      expect(plan.tone?.pan).toBe(0)
    }),
  )
})

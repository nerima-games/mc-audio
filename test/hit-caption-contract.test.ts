import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref, Result } from 'effect'
import { PositionAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import { makeRecordingBackend, AudioBackendPort } from '../src/domain/backend-port'
import type { CaptionEvent } from '../src/domain/caption'
import { mapAudioEvent } from '../src/domain/audio-event-map'
import { type CueContext, makeSoundCueService, recordingCaptionLayer } from '../src/domain/engine'
import { DEFAULT_VOLUME_SETTINGS } from '../src/domain/volume'
import { testClockLayer } from './test-clock'

/**
 * Contract: the time of a hit sound is `CaptionEvent.atSecs`. The host maps an
 * `attack` event to `entityHit`, plays it, and reads the event time from the
 * caption on the `CaptionStream`. There is no separate hit event.
 */

const LISTENER = { x: PositionAxis(0), y: PositionAxis(64), z: PositionAxis(0) }
const context: CueContext = {
  availability: 'ready',
  enabled: true,
  listener: LISTENER,
  settings: DEFAULT_VOLUME_SETTINGS,
}

/** Maps an attack event to its cue, plays it at x = 6, and returns the emitted captions. */
const playAttack = (clockSecs: number): Effect.Effect<ReadonlyArray<CaptionEvent>> =>
  Effect.gen(function* playAttackEffect() {
    const mapping = Result.getOrThrow(mapAudioEvent({ kind: 'attack' }))
    if (mapping.cueId === null) {
      return yield* Effect.die('attack mapped to no cue')
    }
    const recorded = yield* makeRecordingBackend('ready')
    const log = yield* Ref.make<ReadonlyArray<CaptionEvent>>([])

    const service = yield* makeSoundCueService({ context: Effect.succeed(context) }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(AudioBackendPort, recorded.backend),
          recordingCaptionLayer((event) => Ref.update(log, (current) => [...current, event])),
          testClockLayer(clockSecs),
        ),
      ),
    )

    yield* service.play(mapping.cueId, {
      position: { x: PositionAxis(6), y: PositionAxis(64), z: PositionAxis(0) },
    })

    return yield* Ref.get(log)
  })

describe('entityHit caption contract', () => {
  it.effect('an attack event yields one entityHit caption stamped with the clock time', () =>
    Effect.gen(function* () {
      const captions = yield* playAttack(42.5)

      expect(captions).toHaveLength(1)
      expect(captions[0]?.cueId).toBe('entityHit')
      expect(captions[0]?.text).toBe('Attack lands')
      expect(captions[0]?.atSecs).toBe(42.5)
    }),
  )

  it.effect('atSecs follows the injected ClockPort rather than a constant', () =>
    Effect.gen(function* () {
      const first = yield* playAttack(42.5)
      const second = yield* playAttack(7)

      expect(first[0]?.atSecs).toBe(42.5)
      expect(second[0]?.atSecs).toBe(7)
    }),
  )

  it.effect('carries the listener-relative pan of the hit position', () =>
    Effect.gen(function* () {
      const captions = yield* playAttack(1)

      // Source 6 blocks to the right of the listener: pan 0.5, as pinned by
      // test/volume.test.ts for spatialise(LISTENER, position(6, 64, 0)).
      expect(captions[0]?.pan).toBeCloseTo(0.5, 10)
    }),
  )
})

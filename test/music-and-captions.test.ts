import { MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import {
  CAPTION_DISPLAY_SECS,
  MAX_VISIBLE_CAPTIONS,
  visibleCaptions,
  type CaptionEvent,
} from '../src/domain/caption'
import { isSoundCueId, SOUND_CUE_IDS, CUE_DEFINITIONS } from '../src/domain/cue'
import {
  DEFAULT_CAVE_THRESHOLD_Y,
  resolveMusicEnvironment,
  resolveMusicPlan,
  type MusicEnvironment,
} from '../src/domain/music'

describe('resolveMusicEnvironment', () => {
  it.effect('cave wins over day and night', () =>
    Effect.sync(() => {
      expect(resolveMusicEnvironment({ playerPosition: { x: 0, y: 10, z: 0 }, isNight: false })).toBe('cave')
      expect(resolveMusicEnvironment({ playerPosition: { x: 0, y: 10, z: 0 }, isNight: true })).toBe('cave')
    }),
  )

  it.effect('picks day or night above the threshold', () =>
    Effect.sync(() => {
      expect(resolveMusicEnvironment({ playerPosition: { x: 0, y: 70, z: 0 }, isNight: false })).toBe('day')
      expect(resolveMusicEnvironment({ playerPosition: { x: 0, y: 70, z: 0 }, isNight: true })).toBe('night')
    }),
  )

  /**
   * REGRESSION: the comparison is strict `<`, not `<=`.
   *
   * A player standing exactly on the threshold must resolve to the surface. If
   * the boundary were inclusive, walking over a one-block step at y = 40 would
   * retrigger the music on every crossing. The reference implementation has a
   * dedicated boundary test for this
   * (`packages/game/test/music-manager-environment.test.ts`).
   */
  it.effect('treats exactly-at-threshold as surface, not cave', () =>
    Effect.sync(() => {
      expect(resolveMusicEnvironment({ playerPosition: { x: 0, y: DEFAULT_CAVE_THRESHOLD_Y, z: 0 }, isNight: false })).toBe('day')
      expect(resolveMusicEnvironment({ playerPosition: { x: 0, y: DEFAULT_CAVE_THRESHOLD_Y - 1, z: 0 }, isNight: false })).toBe('cave')
    }),
  )

  it.effect('honours a caller-supplied threshold', () =>
    Effect.sync(() => {
      expect(resolveMusicEnvironment({ playerPosition: { x: 0, y: 50, z: 0 }, isNight: false, caveThresholdY: 60 })).toBe('cave')
    }),
  )
})

describe('resolveMusicPlan', () => {
  const day: Option.Option<MusicEnvironment> = Option.some('day')

  it.effect('starts a track when nothing is playing', () =>
    Effect.sync(() => {
      expect(resolveMusicPlan({ enabled: true, active: Option.none(), desired: 'day' })).toStrictEqual({
        shouldStopActiveTrack: false,
        environmentToPlay: Option.some('day'),
      })
    }),
  )

  /** The silent bug: retriggering the same track on every frame. */
  it.effect('does nothing at all when the desired track is already playing', () =>
    Effect.sync(() => {
      expect(resolveMusicPlan({ enabled: true, active: day, desired: 'day' })).toStrictEqual({
        shouldStopActiveTrack: false,
        environmentToPlay: Option.none(),
      })
    }),
  )

  it.effect('stops the old track and starts the new one on a change', () =>
    Effect.sync(() => {
      expect(resolveMusicPlan({ enabled: true, active: day, desired: 'cave' })).toStrictEqual({
        shouldStopActiveTrack: true,
        environmentToPlay: Option.some('cave'),
      })
    }),
  )

  it.effect('stops the active track when music is turned off mid-track', () =>
    Effect.sync(() => {
      expect(resolveMusicPlan({ enabled: false, active: day, desired: 'cave' })).toStrictEqual({
        shouldStopActiveTrack: true,
        environmentToPlay: Option.none(),
      })
    }),
  )

  it.effect('asks for nothing when disabled with nothing playing', () =>
    Effect.sync(() => {
      expect(resolveMusicPlan({ enabled: false, active: Option.none(), desired: 'day' })).toStrictEqual({
        shouldStopActiveTrack: false,
        environmentToPlay: Option.none(),
      })
    }),
  )
})

const caption = (text: string, atSecs: number): CaptionEvent => ({
  cueId: 'blockBreak',
  text,
  atSecs: MonotonicTimeSecs(atSecs),
  reason: 'audible',
})

describe('visibleCaptions', () => {
  it.effect('drops captions older than the display window', () =>
    Effect.sync(() => {
      const events = [caption('old', 0), caption('fresh', 9)]
      const visible = visibleCaptions(events, MonotonicTimeSecs(10))

      expect(visible.map((event) => event.text)).toStrictEqual(['fresh'])
    }),
  )

  it.effect('keeps a caption right up to, but not including, the expiry instant', () =>
    Effect.sync(() => {
      expect(visibleCaptions([caption('a', 0)], MonotonicTimeSecs(CAPTION_DISPLAY_SECS - 0.001))).toHaveLength(1)
      expect(visibleCaptions([caption('a', 0)], MonotonicTimeSecs(CAPTION_DISPLAY_SECS))).toHaveLength(0)
    }),
  )

  it.effect('refreshes a repeated caption instead of stacking a duplicate row', () =>
    Effect.sync(() => {
      const visible = visibleCaptions([caption('Footsteps', 1), caption('Footsteps', 2)], MonotonicTimeSecs(2.5))

      expect(visible).toHaveLength(1)
      expect(visible[0]?.atSecs).toBe(2)
    }),
  )

  it.effect('deduplicates by text, so two footstep cues share one row', () =>
    Effect.sync(() => {
      const grass: CaptionEvent = { cueId: 'footstepGrass', text: 'Footsteps', atSecs: MonotonicTimeSecs(1), reason: 'audible' }
      const stone: CaptionEvent = { cueId: 'footstepStone', text: 'Footsteps', atSecs: MonotonicTimeSecs(1.2), reason: 'audible' }

      expect(visibleCaptions([grass, stone], MonotonicTimeSecs(2))).toHaveLength(1)
    }),
  )

  it.effect('caps the list, keeping the most recent', () =>
    Effect.sync(() => {
      const events = Array.from({ length: MAX_VISIBLE_CAPTIONS + 3 }, (_unused, index) =>
        caption(`row-${String(index)}`, index * 0.1),
      )
      const visible = visibleCaptions(events, MonotonicTimeSecs(0.9))

      expect(visible).toHaveLength(MAX_VISIBLE_CAPTIONS)
      expect(visible[visible.length - 1]?.text).toBe(`row-${String(MAX_VISIBLE_CAPTIONS + 2)}`)
    }),
  )

  it.effect('ignores an event stamped in the future rather than showing it early', () =>
    Effect.sync(() => {
      expect(visibleCaptions([caption('later', 5)], MonotonicTimeSecs(1))).toStrictEqual([])
    }),
  )
})

describe('cue roster', () => {
  it.effect('narrows a known cue id and rejects an unknown one', () =>
    Effect.sync(() => {
      expect(isSoundCueId('blockBreak')).toBe(true)
      expect(isSoundCueId('BlockBreak')).toBe(false)
      expect(isSoundCueId('')).toBe(false)
    }),
  )

  it.effect('has a definition for every cue, with no duplicates in the roster', () =>
    Effect.sync(() => {
      expect(new Set(SOUND_CUE_IDS).size).toBe(SOUND_CUE_IDS.length)
      expect(Object.keys(CUE_DEFINITIONS).sort()).toStrictEqual([...SOUND_CUE_IDS].sort())
    }),
  )

  it.effect('keeps every base gain inside the mixing headroom', () =>
    Effect.sync(() => {
      for (const cueId of SOUND_CUE_IDS) {
        const definition = CUE_DEFINITIONS[cueId]
        expect(definition.baseGain).toBeGreaterThan(0)
        expect(definition.baseGain).toBeLessThanOrEqual(1)
      }
    }),
  )
})

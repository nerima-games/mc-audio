import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { planCue, type CueContext } from '../src/domain/engine'
import {
  clamp01,
  clampPan,
  DEFAULT_VOLUME_SETTINGS,
  effectiveMusicGain,
  effectiveSfxGain,
  masterNodeGain,
  NO_SPATIALISATION,
  spatialise,
  SPATIAL_DISTANCE_SCALE,
  VOLUME_CATEGORIES,
} from '../src/domain/volume'
import { musicTrackGain, MUSIC_TRACKS } from '../src/domain/music'

const LISTENER = { x: 0, y: 64, z: 0 }

const context = (overrides: Partial<CueContext> = {}): CueContext => ({
  settings: DEFAULT_VOLUME_SETTINGS,
  enabled: true,
  availability: 'ready',
  listener: LISTENER,
  ...overrides,
})

describe('volume categories', () => {
  it.effect('are exactly master, sfx and music', () =>
    Effect.sync(() => {
      expect([...VOLUME_CATEGORIES]).toStrictEqual(['master', 'sfx', 'music'])
    }),
  )

  it.effect('carry the reference implementation defaults', () =>
    Effect.sync(() => {
      // packages/game/application/settings-service.ts:35-37
      expect(DEFAULT_VOLUME_SETTINGS).toStrictEqual({ master: 0.8, sfx: 1, music: 0.55 })
    }),
  )
})

/**
 * REGRESSION: master volume is applied exactly once.
 *
 * If master were also multiplied into the per-cue gain it would be squared —
 * a master of 0.5 would sound like 0.25. The reference implementation warns
 * about this in two separate files
 * (`packages/game/application/sound-manager.ts:65-69`,
 * `music-manager-runtime.ts:68-69`) and asserts it at
 * `packages/game/test/sound-manager.test.ts:54-57`, which is strong evidence
 * somebody made the mistake once.
 */
describe('master is applied once, by the backend, and never in a per-cue gain', () => {
  it.effect('sfx gain does not change when master changes', () =>
    Effect.sync(() => {
      const loud = planCue('blockBreak', context({ settings: { master: 1, sfx: 1, music: 1 } }))
      const quiet = planCue('blockBreak', context({ settings: { master: 0.1, sfx: 1, music: 1 } }))

      expect(loud.tone?.gain).toBe(quiet.tone?.gain)
    }),
  )

  it.effect('sfx gain DOES change when the sfx category changes', () =>
    Effect.sync(() => {
      const full = planCue('blockBreak', context({ settings: { master: 1, sfx: 1, music: 1 } }))
      const half = planCue('blockBreak', context({ settings: { master: 1, sfx: 0.5, music: 1 } }))

      expect(full.tone?.gain).toBeCloseTo((half.tone?.gain ?? 0) * 2, 10)
    }),
  )

  it.effect('music gain does not change when master changes', () =>
    Effect.sync(() => {
      expect(musicTrackGain('day', 1)).toBe(MUSIC_TRACKS.day.baseGain)
      expect(musicTrackGain('day', 0.5)).toBeCloseTo(MUSIC_TRACKS.day.baseGain * 0.5, 10)
    }),
  )

  it.effect('masterNodeGain is the only place master turns into a number', () =>
    Effect.sync(() => {
      expect(masterNodeGain(DEFAULT_VOLUME_SETTINGS)).toBe(0.8)
      expect(masterNodeGain({ master: 4, sfx: 1, music: 1 })).toBe(1)
      expect(masterNodeGain({ master: -1, sfx: 1, music: 1 })).toBe(0)
    }),
  )
})

describe('effectiveSfxGain', () => {
  it.effect('multiplies base, category, spatial attenuation and per-call scale', () =>
    Effect.sync(() => {
      expect(
        effectiveSfxGain({ baseGain: 0.5, sfxVolume: 0.5, spatialGain: 0.5, gainScale: 0.5 }),
      ).toBeCloseTo(0.0625, 10)
    }),
  )

  it.effect('defaults gainScale to 1 and refuses a negative one', () =>
    Effect.sync(() => {
      expect(effectiveSfxGain({ baseGain: 1, sfxVolume: 1, spatialGain: 1 })).toBe(1)
      expect(effectiveSfxGain({ baseGain: 1, sfxVolume: 1, spatialGain: 1, gainScale: -5 })).toBe(0)
    }),
  )

  it.effect('clamps into [0, 1] so a loud cue cannot clip the mix', () =>
    Effect.sync(() => {
      expect(effectiveSfxGain({ baseGain: 10, sfxVolume: 10, spatialGain: 1 })).toBe(1)
    }),
  )
})

describe('effectiveMusicGain', () => {
  it.effect('is base times the music category, clamped', () =>
    Effect.sync(() => {
      expect(effectiveMusicGain({ baseGain: 0.4, musicVolume: 0.5 })).toBeCloseTo(0.2, 10)
      expect(effectiveMusicGain({ baseGain: 2, musicVolume: 2 })).toBe(1)
    }),
  )
})

describe('spatialise', () => {
  it.effect('is full gain and dead centre at zero distance', () =>
    Effect.sync(() => {
      expect(spatialise(LISTENER, LISTENER)).toStrictEqual({ gain: 1, pan: 0 })
      expect(NO_SPATIALISATION).toStrictEqual({ gain: 1, pan: 0 })
    }),
  )

  it.effect('halves the gain at exactly SPATIAL_DISTANCE_SCALE blocks', () =>
    Effect.sync(() => {
      const far = spatialise(LISTENER, { x: SPATIAL_DISTANCE_SCALE, y: 64, z: 0 })
      expect(far.gain).toBeCloseTo(0.5, 10)
    }),
  )

  it.effect('never reaches zero, so distant sounds fade rather than cut off', () =>
    Effect.sync(() => {
      const veryFar = spatialise(LISTENER, { x: 100_000, y: 64, z: 0 })
      expect(veryFar.gain).toBeGreaterThan(0)
      expect(veryFar.gain).toBeLessThan(0.001)
    }),
  )

  it.effect('pans by the X offset only, clamped to [-1, 1]', () =>
    Effect.sync(() => {
      expect(spatialise(LISTENER, { x: 6, y: 64, z: 0 }).pan).toBeCloseTo(0.5, 10)
      expect(spatialise(LISTENER, { x: -6, y: 64, z: 0 }).pan).toBeCloseTo(-0.5, 10)
      expect(spatialise(LISTENER, { x: 9_999, y: 64, z: 0 }).pan).toBe(1)
      // Distance on Z attenuates but does not pan.
      expect(spatialise(LISTENER, { x: 0, y: 64, z: 50 }).pan).toBe(0)
    }),
  )
})

describe('clamps', () => {
  it.effect('clamp01 maps a non-finite input to 0 rather than propagating NaN into the graph', () =>
    Effect.sync(() => {
      expect(clamp01(Number.NaN)).toBe(0)
      expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0)
      expect(clamp01(0.3)).toBe(0.3)
    }),
  )

  it.effect('clampPan keeps stereo position in range', () =>
    Effect.sync(() => {
      expect(clampPan(-3)).toBe(-1)
      expect(clampPan(3)).toBe(1)
      expect(clampPan(Number.NaN)).toBe(0)
    }),
  )
})

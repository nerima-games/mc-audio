import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { PositionAxis, type Position } from '@nerima-games/mc-kernel/domain/coordinates'
import { AudioDistance, AudioGain, AudioOffset, AudioVolume } from '../src/domain/audio-brands.js'
import { SoundCueId } from '../src/domain/cue'
import { planCue, type CueContext } from '../src/domain/engine'
import {
  clamp01,
  clampNonNegative,
  clampPan,
  DEFAULT_VOLUME_SETTINGS,
  effectiveMusicGain,
  effectiveSfxGain,
  masterNodeGain,
  minecraftSpatialise,
  NO_SPATIALISATION,
  spatialise,
  SPATIAL_DISTANCE_SCALE,
  VOLUME_CATEGORIES,
} from '../src/domain/volume'
import { musicTrackGain, MUSIC_TRACKS } from '../src/domain/music'

const position = (x: number, y: number, z: number): Position => ({
  x: PositionAxis(x),
  y: PositionAxis(y),
  z: PositionAxis(z),
})

const LISTENER = position(0, 64, 0)
const BLOCK_BREAK = SoundCueId('blockBreak')
const volumeSettings = (master: number, sfx: number, music: number) => ({
  master: AudioVolume(master),
  sfx: AudioVolume(sfx),
  music: AudioVolume(music),
})

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
      expect(DEFAULT_VOLUME_SETTINGS).toStrictEqual(volumeSettings(0.8, 1, 0.55))
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
      const loud = planCue(BLOCK_BREAK, context({ settings: volumeSettings(1, 1, 1) }))
      const quiet = planCue(BLOCK_BREAK, context({ settings: volumeSettings(0.1, 1, 1) }))

      expect(loud.tone?.gain).toBe(quiet.tone?.gain)
    }),
  )

  it.effect('sfx gain DOES change when the sfx category changes', () =>
    Effect.sync(() => {
      const full = planCue(BLOCK_BREAK, context({ settings: volumeSettings(1, 1, 1) }))
      const half = planCue(BLOCK_BREAK, context({ settings: volumeSettings(1, 0.5, 1) }))

      expect(full.tone?.gain).toBeCloseTo((half.tone?.gain ?? 0) * 2, 10)
    }),
  )

  it.effect('music gain does not change when master changes', () =>
    Effect.sync(() => {
      expect(musicTrackGain('day', AudioVolume(1))).toBe(MUSIC_TRACKS.day.baseGain)
      expect(musicTrackGain('day', AudioVolume(0.5))).toBeCloseTo(MUSIC_TRACKS.day.baseGain * 0.5, 10)
    }),
  )

  it.effect('masterNodeGain is the only place master turns into a number', () =>
    Effect.sync(() => {
      expect(masterNodeGain(DEFAULT_VOLUME_SETTINGS)).toBe(0.8)
      expect(masterNodeGain(volumeSettings(1, 1, 1))).toBe(1)
      expect(masterNodeGain(volumeSettings(0, 1, 1))).toBe(0)
    }),
  )
})

describe('effectiveSfxGain', () => {
  it.effect('multiplies base, category, spatial attenuation and per-call scale', () =>
    Effect.sync(() => {
      expect(
        effectiveSfxGain({ baseGain: AudioGain(0.5), sfxVolume: AudioVolume(0.5), spatialGain: AudioVolume(0.5), gainScale: AudioGain(0.5) }),
      ).toBeCloseTo(0.0625, 10)
    }),
  )

  it.effect('defaults gainScale to 1 and refuses a negative one', () =>
    Effect.sync(() => {
      expect(effectiveSfxGain({ baseGain: AudioGain(1), sfxVolume: AudioVolume(1), spatialGain: AudioVolume(1) })).toBe(1)
      expect(Option.isNone(AudioGain.option(-5))).toBe(true)
    }),
  )

  it.effect('keeps a loud cue finite without clipping its official event gain', () =>
    Effect.sync(() => {
      expect(effectiveSfxGain({ baseGain: AudioGain(10), sfxVolume: AudioVolume(1), spatialGain: AudioVolume(1) })).toBe(10)
    }),
  )
})

describe('effectiveMusicGain', () => {
  it.effect('is base times the music category, clamped', () =>
    Effect.sync(() => {
      expect(effectiveMusicGain({ baseGain: AudioGain(0.4), musicVolume: AudioVolume(0.5) })).toBeCloseTo(0.2, 10)
      expect(effectiveMusicGain({ baseGain: AudioGain(2), musicVolume: AudioVolume(1) })).toBe(2)
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
      const far = spatialise(LISTENER, position(SPATIAL_DISTANCE_SCALE, 64, 0))
      expect(far.gain).toBeCloseTo(0.5, 10)
    }),
  )

  it.effect('applies a positive distance offset to attenuation without changing pan', () =>
    Effect.sync(() => {
      const offset = spatialise(LISTENER, position(6, 64, 0), { distanceOffset: AudioOffset(6) })
      expect(offset.gain).toBeCloseTo(0.5, 10)
      expect(offset.pan).toBeCloseTo(0.5, 10)
      expect(spatialise(LISTENER, LISTENER, { distanceOffset: AudioOffset(0) })).toStrictEqual({ gain: 1, pan: 0 })
      expect(Option.isNone(AudioDistance.option(Number.NaN))).toBe(true)
    }),
  )

  it.effect('never reaches zero, so distant sounds fade rather than cut off', () =>
    Effect.sync(() => {
      const veryFar = spatialise(LISTENER, position(100_000, 64, 0))
      expect(veryFar.gain).toBeGreaterThan(0)
      expect(veryFar.gain).toBeLessThan(0.001)
    }),
  )

  it.effect('uses world +X as right when listener direction is omitted', () =>
    Effect.sync(() => {
      expect(spatialise(LISTENER, position(6, 64, 0)).pan).toBeCloseTo(0.5, 10)
      expect(spatialise(LISTENER, position(-6, 64, 0)).pan).toBeCloseTo(-0.5, 10)
      expect(spatialise(LISTENER, position(9_999, 64, 0)).pan).toBe(1)
      // Distance on Z attenuates but does not pan.
      expect(spatialise(LISTENER, position(0, 64, 50)).pan).toBe(0)
    }),
  )

  it.effect('rotates stereo left and right with the listener', () =>
    Effect.sync(() => {
      const source = position(0, 64, 6)
      expect(spatialise(LISTENER, source, { listenerForward: position(1, 0, 0) }).pan).toBeCloseTo(0.5, 10)
      expect(spatialise(LISTENER, source, { listenerForward: position(-1, 0, 0) }).pan).toBeCloseTo(-0.5, 10)
      expect(spatialise(LISTENER, source, { listenerForward: position(100, 7, 0) }).pan).toBeCloseTo(0.5, 10)
    }),
  )

  it.effect('falls back deterministically for unusable horizontal directions', () =>
    Effect.sync(() => {
      const source = position(6, 64, 0)
      expect(spatialise(LISTENER, source, { listenerForward: position(0, 1, 0) }).pan).toBeCloseTo(0.5, 10)
    }),
  )
})

describe('minecraftSpatialise', () => {
  it.effect('uses a linear cutoff at the variant attenuation distance', () =>
    Effect.sync(() => {
      expect(minecraftSpatialise(LISTENER, LISTENER)).toStrictEqual({ gain: 1, pan: 0 })
      expect(
        minecraftSpatialise(LISTENER, position(6, 64, 0), { distanceScale: AudioDistance(12) }),
      ).toStrictEqual({ gain: 0.5, pan: 0.5 })
      expect(
        minecraftSpatialise(LISTENER, position(12, 64, 0), { distanceScale: AudioDistance(12) }),
      ).toStrictEqual({ gain: 0, pan: 1 })
      expect(
        minecraftSpatialise(LISTENER, position(100_000, 64, 0), { distanceScale: AudioDistance(12) }),
      ).toStrictEqual({ gain: 0, pan: 1 })
    }),
  )

  it.effect('shares generic distance offset, panning, and safe scale handling', () =>
    Effect.sync(() => {
      expect(
        minecraftSpatialise(LISTENER, position(6, 64, 0), { distanceOffset: AudioOffset(6), distanceScale: AudioDistance(24) }),
      ).toStrictEqual({ gain: 0.5, pan: 0.25 })
      expect(minecraftSpatialise(LISTENER, position(6, 64, 0), { distanceScale: AudioDistance(0) })).toStrictEqual({
        gain: 0.5,
        pan: 0.5,
      })
      expect(
        minecraftSpatialise(LISTENER, position(6, 64, 0), { distanceScale: AudioDistance(0) }),
      ).toStrictEqual({ gain: 0.5, pan: 0.5 })
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

  it.effect('clampNonNegative preserves finite values above unity', () =>
    Effect.sync(() => {
      expect(clampNonNegative(Number.NaN)).toBe(0)
      expect(clampNonNegative(Number.POSITIVE_INFINITY)).toBe(0)
      expect(clampNonNegative(-1)).toBe(0)
      expect(clampNonNegative(2.4)).toBe(2.4)
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

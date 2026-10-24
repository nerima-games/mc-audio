import { PositionAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import { MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'
import { describe, expect, it } from 'vitest'
import { AudioEventId, AudioVolume } from '../src/domain/audio-brands'
import {
  INITIAL_WEATHER_AMBIENCE_STATE,
  SOUND_SPEED_BLOCKS_PER_SEC,
  WEATHER_MODES,
  planWeatherAmbience,
  type WeatherAudioSnapshot,
} from '../src/domain/weather-ambience'

const snapshot = (overrides: Partial<WeatherAudioSnapshot> = {}): WeatherAudioSnapshot => ({
  intensity: AudioVolume(1),
  listener: { x: PositionAxis(0), y: PositionAxis(64), z: PositionAxis(0) },
  mode: 'rain',
  occlusion: AudioVolume(0),
  ...overrides,
})

describe('weather ambience planning', () => {
  it('is deterministic and attenuates normalized intensity and occlusion boundaries', () => {
    const input = snapshot({ intensity: AudioVolume(1), occlusion: AudioVolume(0) })
    expect(planWeatherAmbience(input)).toStrictEqual(planWeatherAmbience(input))
    expect(planWeatherAmbience(input).loops[0]?.gain).toBe(1)
    expect(planWeatherAmbience(snapshot({ intensity: AudioVolume(0) })).loops[0]?.gain).toBe(0)
    expect(planWeatherAmbience(snapshot({ occlusion: AudioVolume(1) })).loops[0]?.gain).toBeCloseTo(0.2)
  })

  it('matches the clear, rain, and thunder weather vocabulary', () => {
    expect(WEATHER_MODES).toStrictEqual(['clear', 'rain', 'thunder'])
    expect(planWeatherAmbience(snapshot({ mode: 'clear' })).loops).toStrictEqual([])
    expect(planWeatherAmbience(snapshot({ mode: 'rain' })).loops).toStrictEqual([
      { fadeSecs: 0.75, gain: 1, kind: 'rain' },
    ])
  })

  it('attenuates and delays thunder by listener distance', () => {
    const plan = planWeatherAmbience(
      snapshot({
        mode: 'thunder',
        thunder: {
          id: AudioEventId('bolt-1'),
          occurredAtSecs: MonotonicTimeSecs(10),
          position: { x: PositionAxis(0), y: PositionAxis(64), z: PositionAxis(343) },
        },
      }),
    )
    expect(plan.thunder?.delaySecs).toBeCloseTo(343 / SOUND_SPEED_BLOCKS_PER_SEC)
    expect(plan.thunder?.gain).toBeLessThan(0.04)
    expect(plan.thunder?.pan).toBe(0)
  })

  it('suppresses duplicate thunder event ids across frames', () => {
    const weather = snapshot({
      mode: 'thunder',
      thunder: {
        id: AudioEventId('same'),
        occurredAtSecs: MonotonicTimeSecs(0),
        position: { x: PositionAxis(1), y: PositionAxis(64), z: PositionAxis(0) },
      },
    })
    const first = planWeatherAmbience(weather, INITIAL_WEATHER_AMBIENCE_STATE)
    expect(first.thunder).not.toBeNull()
    expect(planWeatherAmbience(weather, first.nextState).thunder).toBeNull()
  })
})

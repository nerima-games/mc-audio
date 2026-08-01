import { describe, expect, it } from 'vitest'
import {
  INITIAL_WEATHER_AMBIENCE_STATE,
  SOUND_SPEED_BLOCKS_PER_SEC,
  planWeatherAmbience,
  type WeatherAudioSnapshot,
} from '../src/domain/weather-ambience'

const snapshot = (overrides: Partial<WeatherAudioSnapshot> = {}): WeatherAudioSnapshot => ({
  intensity: 1,
  listener: { x: 0, y: 64, z: 0 },
  mode: 'rain',
  occlusion: 0,
  ...overrides,
})

describe('weather ambience planning', () => {
  it('is deterministic and clamps intensity and occlusion boundaries', () => {
    const input = snapshot({ intensity: 2, occlusion: -1 })
    expect(planWeatherAmbience(input)).toStrictEqual(planWeatherAmbience(input))
    expect(planWeatherAmbience(input).loops[0]?.gain).toBe(1)
    expect(planWeatherAmbience(snapshot({ intensity: -1 })).loops[0]?.gain).toBe(0)
    expect(planWeatherAmbience(snapshot({ occlusion: 2 })).loops[0]?.gain).toBeCloseTo(0.2)
  })

  it('uses quiet wind for snow and silence for clear weather', () => {
    expect(planWeatherAmbience(snapshot({ mode: 'snow' })).loops).toStrictEqual([
      { fadeSecs: 0.75, gain: 0.22, kind: 'wind' },
    ])
    expect(planWeatherAmbience(snapshot({ mode: 'clear' })).loops).toStrictEqual([])
  })

  it('attenuates and delays thunder by listener distance', () => {
    const plan = planWeatherAmbience(
      snapshot({
        mode: 'thunder',
        thunder: { id: 'bolt-1', occurredAtSecs: 10, position: { x: 0, y: 64, z: 343 } },
      }),
    )
    expect(plan.thunder?.delaySecs).toBeCloseTo(343 / SOUND_SPEED_BLOCKS_PER_SEC)
    expect(plan.thunder?.gain).toBeLessThan(0.04)
    expect(plan.thunder?.pan).toBe(0)
  })

  it('suppresses duplicate thunder event ids across frames', () => {
    const weather = snapshot({
      mode: 'thunder',
      thunder: { id: 'same', occurredAtSecs: 0, position: { x: 1, y: 64, z: 0 } },
    })
    const first = planWeatherAmbience(weather, INITIAL_WEATHER_AMBIENCE_STATE)
    expect(first.thunder).not.toBeNull()
    expect(planWeatherAmbience(weather, first.nextState).thunder).toBeNull()
  })
})

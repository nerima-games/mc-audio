/* oxlint-disable id-length, max-statements, no-empty-function, no-magic-numbers, sort-imports -- Compact no-op ports make ownership and lifecycle assertions explicit. */
import { describe, expect, it } from 'vitest'
import {
  makeEndAudioController,
  type EndAudioHandle,
  type EndAudioPort,
} from '../src/domain/end-audio-controller'
import type { EndAudioSnapshot } from '../src/domain/end-audio'
import {
  makeWeatherAudioController,
  type WeatherAudioHandle,
  type WeatherAudioPort,
} from '../src/domain/weather-audio-controller'
import type { WeatherAudioSnapshot } from '../src/domain/weather-ambience'
import { AudioEventId, AudioHandleId, AudioVolume } from '../src/domain/audio-brands'
import { PositionAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import { MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'

const position = () => ({ x: PositionAxis(0), y: PositionAxis(64), z: PositionAxis(0) })

const endSnapshot = (overrides: Partial<EndAudioSnapshot> = {}): EndAudioSnapshot => ({
  dimension: 'end',
  events: [],
  listener: position(),
  nowSecs: MonotonicTimeSecs(1),
  phase: 'active',
  ...overrides,
})

const recorder = (primaryAvailable: boolean) => {
  let id = 0
  const created: number[] = []
  const fallback: number[] = []
  const primary: number[] = []
  const released: number[] = []
  const stopped: number[] = []
  const gains: number[] = []
  const next = (): EndAudioHandle => {
    id += 1
    return { id: AudioHandleId(id) }
  }
  const port: EndAudioPort = {
    createLoop: () => {
      const handle = next()
      created.push(handle.id)
      return handle
    },
    playEvent: () => {
      if (!primaryAvailable) {
        return null
      }
      const handle = next()
      primary.push(handle.id)
      return handle
    },
    playFallback: () => {
      const handle = next()
      fallback.push(handle.id)
      return handle
    },
    release: (handle) => released.push(handle.id),
    setLoopGain: (_handle, gain) => gains.push(gain),
    stopLoop: (handle) => stopped.push(handle.id),
  }
  return { created, fallback, gains, port, primary, released, stopped }
}

describe('End audio controller', () => {
  it('falls back for an unsupported event and releases it when its lifetime ends', () => {
    const record = recorder(false)
    const controller = makeEndAudioController(record.port)
    controller.update(endSnapshot({ events: [{ id: AudioEventId('flap'), kind: 'dragonFlap', position: position() }] }))
    controller.update(endSnapshot({ nowSecs: MonotonicTimeSecs(2) }))
    expect(record.created).toStrictEqual([1])
    expect(record.fallback).toStrictEqual([2])
    expect(record.released).toStrictEqual([2])
    expect(record.gains).toStrictEqual([0.18])
  })

  it('prefers primary playback, transitions its loop, and disposes idempotently', () => {
    const record = recorder(true)
    const controller = makeEndAudioController(record.port)
    controller.update(endSnapshot({ events: [{ id: AudioEventId('roar'), kind: 'dragonRoar', position: position() }] }))
    controller.update(endSnapshot({ dimension: 'overworld', nowSecs: MonotonicTimeSecs(1.1), phase: 'unstarted' }))
    controller.dispose()
    controller.dispose()
    controller.update(endSnapshot({ nowSecs: MonotonicTimeSecs(9) }))
    expect(record.primary).toStrictEqual([2])
    expect(record.fallback).toStrictEqual([])
    expect(record.stopped).toStrictEqual([1])
    expect(record.released.sort()).toStrictEqual([1, 2])
  })

  it('advances safely when neither primary, fallback, nor loop rendering is available', () => {
    let attempts = 0
    const port: EndAudioPort = {
      createLoop: () => null,
      playEvent: () => {
        attempts += 1
        return null
      },
      playFallback: () => null,
      release: () => {},
      setLoopGain: () => {},
      stopLoop: () => {},
    }
    const controller = makeEndAudioController(port)
    const input = endSnapshot({ events: [{ id: AudioEventId('hurt'), kind: 'dragonHurt', position: position() }] })
    controller.update(input)
    controller.update(input)
    controller.dispose()
    expect(attempts).toBe(1)
    expect(controller.state().recentEventIds).toStrictEqual(['hurt'])
  })

  it('coexists with weather audio and releases only its own handles', () => {
    let id = 0
    const released: number[] = []
    const stopped: number[] = []
    const next = (): { readonly id: AudioHandleId } => {
      id += 1
      return { id: AudioHandleId(id) }
    }
    const shared = {
      release: (handle: { readonly id: number }) => released.push(handle.id),
      stopLoop: (handle: { readonly id: number }) => stopped.push(handle.id),
    }
    const weatherPort: WeatherAudioPort = {
      createLoop: () => next() satisfies WeatherAudioHandle,
      playThunder: () => next() satisfies WeatherAudioHandle,
      release: shared.release,
      setLoopGain: () => {},
      stopLoop: shared.stopLoop,
    }
    const endPort: EndAudioPort = {
      createLoop: () => next() satisfies EndAudioHandle,
      playEvent: () => next() satisfies EndAudioHandle,
      playFallback: () => next() satisfies EndAudioHandle,
      release: shared.release,
      setLoopGain: () => {},
      stopLoop: shared.stopLoop,
    }
    const weather = makeWeatherAudioController(weatherPort)
    const end = makeEndAudioController(endPort)
    const rain: WeatherAudioSnapshot = {
      intensity: AudioVolume(1),
      listener: position(),
      mode: 'rain',
      occlusion: AudioVolume(0),
    }
    weather.update(rain)
    end.update(endSnapshot({ events: [{ id: AudioEventId('roar'), kind: 'dragonRoar', position: position() }] }))
    end.dispose()
    expect(released.sort()).toStrictEqual([2, 3])
    expect(stopped).toStrictEqual([2])

    weather.update({ ...rain, intensity: AudioVolume(0.5) })
    weather.dispose()
    expect(released.sort()).toStrictEqual([1, 2, 3])
    expect(stopped).toStrictEqual([2, 1])
  })

  it('normalizes an untyped NaN clock before playback and state updates', () => {
    const record = recorder(true)
    const controller = makeEndAudioController(record.port)
    const snapshot = endSnapshot({
      events: [{ id: AudioEventId('roar'), kind: 'dragonRoar', position: position() }],
    })
    expect(Reflect.set(snapshot, 'nowSecs', Number.NaN)).toBe(true)

    expect(() => controller.update(snapshot)).not.toThrow()
    expect(record.primary).toHaveLength(1)
    expect(controller.state().lastPlayedAtSecs.dragonRoar).toBe(0)
  })

  it('tracks an event at the branded start of the clock', () => {
    const record = recorder(true)
    const controller = makeEndAudioController(record.port)
    controller.update(endSnapshot({
      events: [{ id: AudioEventId('roar'), kind: 'dragonRoar', position: position() }],
      nowSecs: MonotonicTimeSecs(0),
    }))
    expect(controller.state().lastPlayedAtSecs.dragonRoar).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { AudioEventId, AudioHandleId, AudioVolume } from '../src/domain/audio-brands'
import { PositionAxis, type Position } from '@nerima-games/mc-kernel/domain/coordinates'
import { MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'
import {
  makeWeatherAudioController,
  type WeatherAudioHandle,
  type WeatherAudioPort,
} from '../src/domain/weather-audio-controller'
import type { WeatherAudioSnapshot, WeatherLoopKind } from '../src/domain/weather-ambience'

const position = (x: number, y: number, z: number): Position => ({
  x: PositionAxis(x),
  y: PositionAxis(y),
  z: PositionAxis(z),
})

const weather = (mode: WeatherAudioSnapshot['mode']): WeatherAudioSnapshot => ({
  intensity: AudioVolume(0.8),
  listener: position(0, 64, 0),
  mode,
  occlusion: AudioVolume(0),
})

const recorder = () => {
  let id = 0
  const created: Array<{ kind: WeatherLoopKind; handle: WeatherAudioHandle }> = []
  const gains: number[] = []
  const stopped: number[] = []
  const released: number[] = []
  const thunder: number[] = []
  const next = (): WeatherAudioHandle => {
    id += 1
    return { id: AudioHandleId(id) }
  }
  const port: WeatherAudioPort = {
    createLoop: (kind) => {
      const handle = next()
      created.push({ handle, kind })
      return handle
    },
    playThunder: () => {
      const handle = next()
      thunder.push(handle.id)
      return handle
    },
    release: (handle) => released.push(handle.id),
    setLoopGain: (_handle, gain) => gains.push(gain),
    stopLoop: (handle) => stopped.push(handle.id),
  }
  return { created, gains, port, released, stopped, thunder }
}

describe('weather audio controller', () => {
  it('reuses a loop, crossfades its gain, and replaces it on mode change', () => {
    const record = recorder()
    const controller = makeWeatherAudioController(record.port)
    controller.update(weather('rain'))
    controller.update({ ...weather('rain'), intensity: AudioVolume(0.4) })
    controller.update(weather('clear'))
    expect(record.created.map(({ kind }) => kind)).toStrictEqual(['rain'])
    expect(record.gains).toStrictEqual([0.4])
    expect(record.stopped).toStrictEqual([1])
    expect(record.released).toStrictEqual([1])
  })

  it('plays one thunder event once and releases every live handle on dispose', () => {
    const record = recorder()
    const controller = makeWeatherAudioController(record.port)
    const storm = {
      ...weather('thunder'),
      thunder: {
        id: AudioEventId('bolt'),
        occurredAtSecs: MonotonicTimeSecs(1),
        position: position(0, 64, 10),
      },
    }
    controller.update(storm)
    controller.update(storm)
    controller.dispose()
    controller.dispose()
    expect(record.thunder).toStrictEqual([2])
    expect(record.released.sort()).toStrictEqual([1, 2])
    expect(record.stopped).toStrictEqual([1])
  })

  it('ignores every update once disposed, rather than resurrecting released loops', () => {
    const record = recorder()
    const controller = makeWeatherAudioController(record.port)
    controller.update(weather('rain'))
    controller.dispose()
    record.created.length = 0
    record.gains.length = 0

    controller.update(weather('rain'))

    expect(record.created).toStrictEqual([])
    expect(record.gains).toStrictEqual([])
    expect(controller.state()).toStrictEqual({ lastThunderEventId: null, mode: 'rain' })
  })
})

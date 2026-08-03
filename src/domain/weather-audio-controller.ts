import {
  INITIAL_WEATHER_AMBIENCE_STATE,
  WEATHER_FADE_SECS,
  planWeatherAmbience,
  type WeatherAmbienceState,
  type WeatherAudioSnapshot,
  type WeatherLoopKind,
} from './weather-ambience'

export type WeatherAudioHandle = { readonly id: number }

export type WeatherAudioPort = {
  readonly createLoop: (kind: WeatherLoopKind, initialGain: number) => WeatherAudioHandle
  readonly setLoopGain: (handle: WeatherAudioHandle, gain: number, fadeSecs: number) => void
  readonly stopLoop: (handle: WeatherAudioHandle, fadeSecs: number) => void
  readonly playThunder: (request: {
    readonly delaySecs: number
    readonly gain: number
    readonly pan: number
  }) => WeatherAudioHandle
  readonly release: (handle: WeatherAudioHandle) => void
}

export type WeatherAudioController = {
  readonly update: (snapshot: WeatherAudioSnapshot) => void
  readonly dispose: () => void
  readonly state: () => WeatherAmbienceState
}

export const makeWeatherAudioController = (port: WeatherAudioPort): WeatherAudioController => {
  const loops = new Map<WeatherLoopKind, WeatherAudioHandle>()
  const transient = new Set<WeatherAudioHandle>()
  let currentState = INITIAL_WEATHER_AMBIENCE_STATE
  let disposed = false

  const update = (snapshot: WeatherAudioSnapshot): void => {
    if (disposed) return
    const plan = planWeatherAmbience(snapshot, currentState)
    const desired = new Set(plan.loops.map((loop) => loop.kind))

    for (const [kind, handle] of loops) {
      if (!desired.has(kind)) {
        port.stopLoop(handle, WEATHER_FADE_SECS)
        port.release(handle)
        loops.delete(kind)
      }
    }
    for (const loop of plan.loops) {
      const existing = loops.get(loop.kind)
      if (existing === undefined) {
        loops.set(loop.kind, port.createLoop(loop.kind, loop.gain))
      } else {
        port.setLoopGain(existing, loop.gain, loop.fadeSecs)
      }
    }
    if (plan.thunder !== null) {
      transient.add(port.playThunder(plan.thunder))
    }
    currentState = plan.nextState
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const handle of loops.values()) {
      port.stopLoop(handle, WEATHER_FADE_SECS)
      port.release(handle)
    }
    for (const handle of transient) port.release(handle)
    loops.clear()
    transient.clear()
  }

  return { dispose, state: () => currentState, update }
}

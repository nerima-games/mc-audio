import {
  INITIAL_WEATHER_AMBIENCE_STATE,
  WEATHER_FADE_SECS,
  type WeatherAmbiencePlan,
  type WeatherAmbienceState,
  type WeatherAudioSnapshot,
  type WeatherLoopKind,
  planWeatherAmbience,
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

/** Stop and release any loop the plan no longer wants running. */
const stopUnwantedLoops = (input: {
  readonly loops: Map<WeatherLoopKind, WeatherAudioHandle>
  readonly desired: ReadonlySet<WeatherLoopKind>
  readonly port: WeatherAudioPort
}): void => {
  for (const [kind, handle] of input.loops) {
    if (!input.desired.has(kind)) {
      input.port.stopLoop(handle, WEATHER_FADE_SECS)
      input.port.release(handle)
      input.loops.delete(kind)
    }
  }
}

/** Start each planned loop that isn't already running, and retune the ones that are. */
const startOrRetuneLoops = (input: {
  readonly loops: Map<WeatherLoopKind, WeatherAudioHandle>
  readonly plan: WeatherAmbiencePlan
  readonly port: WeatherAudioPort
}): void => {
  for (const loop of input.plan.loops) {
    const existing = input.loops.get(loop.kind)
    if (!existing) {
      input.loops.set(loop.kind, input.port.createLoop(loop.kind, loop.gain))
    } else {
      input.port.setLoopGain(existing, loop.gain, loop.fadeSecs)
    }
  }
}

export const makeWeatherAudioController = (port: WeatherAudioPort): WeatherAudioController => {
  const loops = new Map<WeatherLoopKind, WeatherAudioHandle>()
  const transient = new Set<WeatherAudioHandle>()
  let currentState = INITIAL_WEATHER_AMBIENCE_STATE
  let disposed = false

  const update = (snapshot: WeatherAudioSnapshot): void => {
    if (disposed) {
      return
    }
    const plan = planWeatherAmbience(snapshot, currentState)
    const desired = new Set(plan.loops.map((loop) => loop.kind))

    stopUnwantedLoops({ desired, loops, port })
    startOrRetuneLoops({ loops, plan, port })
    if (plan.thunder !== null) {
      transient.add(port.playThunder(plan.thunder))
    }
    currentState = plan.nextState
  }

  const dispose = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    for (const handle of loops.values()) {
      port.stopLoop(handle, WEATHER_FADE_SECS)
      port.release(handle)
    }
    for (const handle of transient) {
      port.release(handle)
    }
    loops.clear()
    transient.clear()
  }

  return { dispose, state: () => currentState, update }
}

import { clamp01, spatialise, type Vec3 } from './volume'

export const WEATHER_MODES = ['clear', 'rain', 'thunder', 'snow'] as const

export type WeatherMode = (typeof WEATHER_MODES)[number]

export type ThunderEvent = {
  readonly id: string
  readonly occurredAtSecs: number
  readonly position: Vec3
}

export type WeatherAudioSnapshot = {
  readonly mode: WeatherMode
  readonly intensity: number
  readonly listener: Vec3
  readonly listenerForward?: Vec3
  /** Zero is outdoors, one is completely enclosed. */
  readonly occlusion: number
  readonly thunder?: ThunderEvent
}

export type WeatherLoopKind = 'rain' | 'wind'

export type WeatherLoopPlan = {
  readonly kind: WeatherLoopKind
  readonly gain: number
  readonly fadeSecs: number
}

export type ThunderPlan = {
  readonly eventId: string
  readonly delaySecs: number
  readonly gain: number
  readonly pan: number
}

export type WeatherAmbienceState = {
  readonly mode: WeatherMode
  readonly lastThunderEventId: string | null
}

export type WeatherAmbiencePlan = {
  readonly loops: ReadonlyArray<WeatherLoopPlan>
  readonly thunder: ThunderPlan | null
  readonly nextState: WeatherAmbienceState
}

export const INITIAL_WEATHER_AMBIENCE_STATE: WeatherAmbienceState = {
  lastThunderEventId: null,
  mode: 'clear',
}

export const WEATHER_FADE_SECS = 0.75
export const SOUND_SPEED_BLOCKS_PER_SEC = 343

const rainGain = (intensity: number, occlusion: number): number =>
  clamp01(intensity) * (1 - 0.8 * clamp01(occlusion))

const windGain = (intensity: number, occlusion: number): number =>
  0.22 * clamp01(intensity) * (1 - 0.55 * clamp01(occlusion))

export const planWeatherAmbience = (
  snapshot: WeatherAudioSnapshot,
  previous: WeatherAmbienceState = INITIAL_WEATHER_AMBIENCE_STATE,
): WeatherAmbiencePlan => {
  const modeChanged = snapshot.mode !== previous.mode
  const fadeSecs = modeChanged ? WEATHER_FADE_SECS : WEATHER_FADE_SECS / 2
  const loops: ReadonlyArray<WeatherLoopPlan> =
    snapshot.mode === 'rain' || snapshot.mode === 'thunder'
      ? [{ fadeSecs, gain: rainGain(snapshot.intensity, snapshot.occlusion), kind: 'rain' }]
      : snapshot.mode === 'snow'
        ? [{ fadeSecs, gain: windGain(snapshot.intensity, snapshot.occlusion), kind: 'wind' }]
        : []

  const event = snapshot.mode === 'thunder' ? snapshot.thunder : undefined
  const isNewEvent = event !== undefined && event.id !== previous.lastThunderEventId
  const spatial =
    event === undefined
      ? null
      : spatialise(snapshot.listener, event.position, snapshot.listenerForward)
  const distance =
    event === undefined
      ? 0
      : Math.hypot(
          event.position.x - snapshot.listener.x,
          event.position.y - snapshot.listener.y,
          event.position.z - snapshot.listener.z,
        )
  const thunder =
    isNewEvent && event !== undefined && spatial !== null
      ? {
          delaySecs: distance / SOUND_SPEED_BLOCKS_PER_SEC,
          eventId: event.id,
          gain: clamp01(spatial.gain * (1 - 0.65 * clamp01(snapshot.occlusion))),
          pan: spatial.pan,
        }
      : null

  return {
    loops,
    nextState: {
      lastThunderEventId: event?.id ?? previous.lastThunderEventId,
      mode: snapshot.mode,
    },
    thunder,
  }
}

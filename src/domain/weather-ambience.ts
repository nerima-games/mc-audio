import { clamp01, spatialise } from './volume.js'
import type { Position } from '@nerima-games/mc-kernel'

export const WEATHER_MODES = ['clear', 'rain', 'thunder', 'snow'] as const

export type WeatherMode = (typeof WEATHER_MODES)[number]

export type ThunderEvent = {
  readonly id: string
  readonly occurredAtSecs: number
  readonly position: Position
}

export type WeatherAudioSnapshot = {
  readonly mode: WeatherMode
  readonly intensity: number
  readonly listener: Position
  readonly listenerForward?: Position
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

/** A fully open, unattenuated multiplier — the top of every `1 - k * clamp01(...)` attenuation curve below. */
const FULL = 1
/** A mode change gets the full crossfade; staying in the same mode gets a quicker settle. */
const FADE_HALVED = 2

const RAIN_OCCLUSION_ATTENUATION = 0.8
const WIND_BASE_GAIN = 0.22
const WIND_OCCLUSION_ATTENUATION = 0.55
const THUNDER_OCCLUSION_ATTENUATION = 0.65

const rainGain = (intensity: number, occlusion: number): number =>
  clamp01(intensity) * (FULL - RAIN_OCCLUSION_ATTENUATION * clamp01(occlusion))

const windGain = (intensity: number, occlusion: number): number =>
  WIND_BASE_GAIN * clamp01(intensity) * (FULL - WIND_OCCLUSION_ATTENUATION * clamp01(occlusion))

/**
 * The thunder half of the plan: whether this snapshot carries a *new* thunder
 * event (one whose id differs from the last one remembered), and the id the
 * next state should remember either way.
 */
const resolveThunder = (
  snapshot: WeatherAudioSnapshot,
  previous: WeatherAmbienceState,
): { readonly plan: ThunderPlan | null; readonly lastThunderEventId: string | null } => {
  if (snapshot.mode !== 'thunder' || !snapshot.thunder) {
    return { lastThunderEventId: previous.lastThunderEventId, plan: null }
  }
  const event = snapshot.thunder

  if (event.id === previous.lastThunderEventId) {
    return { lastThunderEventId: event.id, plan: null }
  }

  const spatial = spatialise(snapshot.listener, event.position, {
    listenerForward: snapshot.listenerForward,
  })
  const distance = Math.hypot(
    event.position.x - snapshot.listener.x,
    event.position.y - snapshot.listener.y,
    event.position.z - snapshot.listener.z,
  )

  return {
    lastThunderEventId: event.id,
    plan: {
      delaySecs: distance / SOUND_SPEED_BLOCKS_PER_SEC,
      eventId: event.id,
      gain: clamp01(spatial.gain * (FULL - THUNDER_OCCLUSION_ATTENUATION * clamp01(snapshot.occlusion))),
      pan: spatial.pan,
    },
  }
}

export const planWeatherAmbience = (
  snapshot: WeatherAudioSnapshot,
  previous: WeatherAmbienceState = INITIAL_WEATHER_AMBIENCE_STATE,
): WeatherAmbiencePlan => {
  const modeChanged = snapshot.mode !== previous.mode
  let fadeSecs = WEATHER_FADE_SECS / FADE_HALVED
  if (modeChanged) {
    fadeSecs = WEATHER_FADE_SECS
  }

  let loops: ReadonlyArray<WeatherLoopPlan> = []
  if (snapshot.mode === 'rain' || snapshot.mode === 'thunder') {
    loops = [{ fadeSecs, gain: rainGain(snapshot.intensity, snapshot.occlusion), kind: 'rain' }]
  } else if (snapshot.mode === 'snow') {
    loops = [{ fadeSecs, gain: windGain(snapshot.intensity, snapshot.occlusion), kind: 'wind' }]
  }

  const { lastThunderEventId, plan: thunder } = resolveThunder(snapshot, previous)

  return {
    loops,
    nextState: {
      lastThunderEventId,
      mode: snapshot.mode,
    },
    thunder,
  }
}

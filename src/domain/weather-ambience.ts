import {
  type AudioDurationSecs,
  type AudioEventId,
  type AudioGain,
  type AudioPan,
  type AudioVolume,
  AudioDurationSecs as audioDurationSecs,
  AudioGain as audioGain,
} from './audio-brands.js'
import { clamp01, spatialise } from './volume.js'
import type { MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'
import type { Position } from '@nerima-games/mc-kernel/domain/coordinates'

export const WEATHER_MODES = ['clear', 'rain', 'thunder'] as const

export type WeatherMode = (typeof WEATHER_MODES)[number]

export type ThunderEvent = {
  readonly id: AudioEventId
  readonly occurredAtSecs: MonotonicTimeSecs
  readonly position: Position
}

export type WeatherAudioSnapshot = {
  readonly mode: WeatherMode
  readonly intensity: AudioVolume
  readonly listener: Position
  readonly listenerForward?: Position
  /** Zero is outdoors, one is completely enclosed. */
  readonly occlusion: AudioVolume
  readonly thunder?: ThunderEvent
}

export type WeatherLoopKind = 'rain'

export type WeatherLoopPlan = {
  readonly kind: WeatherLoopKind
  readonly gain: AudioGain
  readonly fadeSecs: AudioDurationSecs
}

export type ThunderPlan = {
  readonly eventId: AudioEventId
  readonly delaySecs: AudioDurationSecs
  readonly gain: AudioGain
  readonly pan: AudioPan
}

export type WeatherAmbienceState = {
  readonly mode: WeatherMode
  readonly lastThunderEventId: AudioEventId | null
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

const WEATHER_FADE_SECS_VALUE = 0.75
export const WEATHER_FADE_SECS: AudioDurationSecs = audioDurationSecs(WEATHER_FADE_SECS_VALUE)
export const SOUND_SPEED_BLOCKS_PER_SEC: number = 343

/** A fully open, unattenuated multiplier — the top of every `1 - k * clamp01(...)` attenuation curve below. */
const FULL = 1
/** A mode change gets the full crossfade; staying in the same mode gets a quicker settle. */
const FADE_HALVED = 2

const RAIN_OCCLUSION_ATTENUATION = 0.8
const THUNDER_OCCLUSION_ATTENUATION = 0.65

const rainGain = (intensity: AudioVolume, occlusion: AudioVolume): AudioGain =>
  audioGain(clamp01(intensity) * (FULL - RAIN_OCCLUSION_ATTENUATION * clamp01(occlusion)))

/**
 * The thunder half of the plan: whether this snapshot carries a *new* thunder
 * event (one whose id differs from the last one remembered), and the id the
 * next state should remember either way.
 */
const resolveThunder = (
  snapshot: WeatherAudioSnapshot,
  previous: WeatherAmbienceState,
): { readonly plan: ThunderPlan | null; readonly lastThunderEventId: AudioEventId | null } => {
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
      delaySecs: audioDurationSecs(distance / SOUND_SPEED_BLOCKS_PER_SEC),
      eventId: event.id,
      gain: audioGain(clamp01(spatial.gain * (FULL - THUNDER_OCCLUSION_ATTENUATION * clamp01(snapshot.occlusion)))),
      pan: spatial.pan,
    },
  }
}

export const planWeatherAmbience = (
  snapshot: WeatherAudioSnapshot,
  previous: WeatherAmbienceState = INITIAL_WEATHER_AMBIENCE_STATE,
): WeatherAmbiencePlan => {
  const modeChanged = snapshot.mode !== previous.mode
  let fadeSecs = audioDurationSecs(WEATHER_FADE_SECS / FADE_HALVED)
  if (modeChanged) {
    fadeSecs = WEATHER_FADE_SECS
  }

  let loops: ReadonlyArray<WeatherLoopPlan> = []
  if (snapshot.mode === 'rain' || snapshot.mode === 'thunder') {
    loops = [{ fadeSecs, gain: rainGain(snapshot.intensity, snapshot.occlusion), kind: 'rain' }]
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

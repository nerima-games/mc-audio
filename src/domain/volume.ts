/**
 * Volume categories and the gain arithmetic.
 *
 * Boundary and provenance notes.
 *
 * ---------------------------------------------------------------------------
 * The one rule: master is applied exactly once
 * ---------------------------------------------------------------------------
 *
 * `masterVolume` is NOT a factor in `effectiveSfxGain` or `effectiveMusicGain`.
 * It is applied by the backend's single master gain node, downstream of every
 * per-cue calculation. Multiplying it in here as well would square it, so a
 * master setting of 0.5 would sound like 0.25.
 *
 * This is not a hypothetical. The reference implementation carries the warning
 * in two places — `packages/game/application/music-manager-runtime.ts:68-69`
 * ("masterVolume is applied ONCE by the engine's master gain node ...
 * multiplying here too would square it") and
 * `packages/game/application/sound-manager.ts:65-69` — and pins it with an
 * assertion at `packages/game/test/sound-manager.test.ts:54-57`. Someone
 * evidently made the mistake once. `test/volume.test.ts` re-pins it here.
 */

import {
  type AudioDistance,
  type AudioGain,
  type AudioOffset,
  type AudioPan,
  type AudioVolume,
  AudioDistance as audioDistance,
  AudioGain as audioGain,
  AudioOffset as audioOffset,
  AudioPan as audioPan,
  AudioVolume as audioVolume,
} from './audio-brands.js'
import { type Position, PositionAxis as positionAxis } from '@nerima-games/mc-kernel/domain/coordinates'

/** The three categories a player can set independently. */
export const VOLUME_CATEGORIES = ['master', 'sfx', 'music'] as const

export type VolumeCategory = (typeof VOLUME_CATEGORIES)[number]

export type VolumeSettings = {
  readonly [Category in VolumeCategory]: AudioVolume
}

const DEFAULT_MASTER_VOLUME_VALUE = 0.8
const DEFAULT_MUSIC_VOLUME_VALUE = 0.55
const UNITY_GAIN = 1

/**
 * Reference-implementation defaults, carried over deliberately.
 * `packages/game/application/settings-service.ts:35-37`.
 *
 * Music sits well below sfx because it is continuous while sfx are transient;
 * equal nominal levels make music dominate perceptually.
 */
export const DEFAULT_VOLUME_SETTINGS: VolumeSettings = {
  master: audioVolume(DEFAULT_MASTER_VOLUME_VALUE),
  music: audioVolume(DEFAULT_MUSIC_VOLUME_VALUE),
  sfx: audioVolume(UNITY_GAIN),
}

/** The gain value representing full, unattenuated volume. */
/** The gain value representing silence — also `clamp01`'s fallback for non-finite input. */
const SILENT_GAIN = 0

/** Pan value representing dead centre — also `clampPan`'s fallback for non-finite input. */
const CENTER_PAN = 0

/** `clampPan`'s bounds: hard right and hard left. */
const MAX_PAN = 1
const MIN_PAN = -1

export const clamp01 = (value: number): AudioVolume => {
  if (!Number.isFinite(value)) {
    return audioVolume(SILENT_GAIN)
  }
  return audioVolume(Math.min(UNITY_GAIN, Math.max(SILENT_GAIN, value)))
}

/** Keep an audio gain finite without discarding official variants louder than unity. */
export const clampNonNegative = (value: number): AudioGain => {
  if (!Number.isFinite(value)) {
    return audioGain(SILENT_GAIN)
  }
  return audioGain(Math.max(SILENT_GAIN, value))
}

export const clampPan = (value: number): AudioPan => {
  if (!Number.isFinite(value)) {
    return audioPan(CENTER_PAN)
  }
  return audioPan(Math.min(MAX_PAN, Math.max(MIN_PAN, value)))
}

/**
 * Distance at which a sound is attenuated to half amplitude, in blocks.
 * `SPATIAL_DISTANCE_SCALE` in `packages/game/domain/sound-spatial.ts:11`.
 */
const SPATIAL_DISTANCE_SCALE_BLOCKS = 12
export const SPATIAL_DISTANCE_SCALE: AudioDistance = audioDistance(SPATIAL_DISTANCE_SCALE_BLOCKS)

export type Spatialisation = {
  /** Multiplicative attenuation in [0, 1]. */
  readonly gain: AudioVolume
  /** Stereo position in [-1, 1]; negative is left. */
  readonly pan: AudioPan
}

export type SpatialisationOptions = {
  readonly distanceOffset?: AudioOffset | undefined
  readonly listenerForward?: Position | undefined
  readonly distanceScale?: AudioDistance | undefined
}

/** Below this horizontal length, `listenerForward` is treated as unusable (looking straight up/down). */
const MIN_FORWARD_LENGTH = 0

/** Fallback "right" unit vector (+x) used when the listener has no usable horizontal forward direction. */
const DEFAULT_RIGHT_X = 1
const DEFAULT_RIGHT_Z = 0
const POSITION_ORIGIN = 0
const BACKWARD_UNIT_AXIS = -1
const MIN_DISTANCE_SCALE_VALUE = 0
const MIN_DISTANCE_SCALE = audioDistance(MIN_DISTANCE_SCALE_VALUE)
const DEFAULT_LISTENER_FORWARD: Position = {
  x: positionAxis(POSITION_ORIGIN),
  y: positionAxis(POSITION_ORIGIN),
  z: positionAxis(BACKWARD_UNIT_AXIS),
}

const resolveDistanceScale = (distanceScale: AudioDistance): number => {
  if (Number.isFinite(distanceScale) && distanceScale > MIN_DISTANCE_SCALE) {
    return distanceScale
  }
  return SPATIAL_DISTANCE_SCALE
}

const resolveDistanceOffset = (distanceOffset: AudioOffset): number => {
  if (Number.isFinite(distanceOffset) && distanceOffset > MIN_DISTANCE_SCALE) {
    return distanceOffset
  }
  return MIN_DISTANCE_SCALE
}

/** The horizontal "right" direction implied by `listenerForward`, or the +x fallback. */
const listenerRight = (
  listenerForward: Position,
  horizontalForwardLength: number,
): { readonly x: number; readonly z: number } => {
  const hasUsableForward =
    Number.isFinite(horizontalForwardLength) && horizontalForwardLength > MIN_FORWARD_LENGTH
  if (!hasUsableForward) {
    return { x: DEFAULT_RIGHT_X, z: DEFAULT_RIGHT_Z }
  }
  return {
    x: -listenerForward.z / horizontalForwardLength,
    z: listenerForward.x / horizontalForwardLength,
  }
}

type SpatialCoordinates = {
  readonly distance: number
  readonly distanceScale: number
  readonly pan: AudioPan
}

const resolveSpatialCoordinates = (
  listener: Position,
  source: Position,
  options: SpatialisationOptions,
): SpatialCoordinates => {
  const {
    distanceOffset = audioOffset(MIN_DISTANCE_SCALE_VALUE),
    distanceScale = SPATIAL_DISTANCE_SCALE,
    listenerForward = DEFAULT_LISTENER_FORWARD,
  } = options
  const resolvedDistanceScale = resolveDistanceScale(distanceScale)
  const resolvedDistanceOffset = resolveDistanceOffset(distanceOffset)
  const dx = source.x - listener.x
  const dy = source.y - listener.y
  const dz = source.z - listener.z
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) + resolvedDistanceOffset
  const horizontalForwardLength = Math.sqrt(
    listenerForward.x * listenerForward.x + listenerForward.z * listenerForward.z,
  )
  const right = listenerRight(listenerForward, horizontalForwardLength)

  return {
    distance,
    distanceScale: resolvedDistanceScale,
    pan: clampPan((dx * right.x + dz * right.z) / resolvedDistanceScale),
  }
}

/**
 * Attenuation and panning for a sound at `source` heard from `listener`.
 *
 * `1 / (1 + d / scale)` rather than inverse-square: it never reaches zero, so a
 * distant sound fades out instead of cutting off, and it is finite at d = 0.
 * Reference: `packages/game/domain/sound-spatial.ts:11-27`.
 */
export const spatialise = (
  listener: Position,
  source: Position,
  options: SpatialisationOptions = {},
): Spatialisation => {
  const { distance, distanceScale, pan } = resolveSpatialCoordinates(listener, source, options)

  return {
    gain: clamp01(UNITY_GAIN / (UNITY_GAIN + distance / distanceScale)),
    pan,
  }
}

/**
 * Minecraft sound-variant attenuation.
 *
 * The variant's finite attenuation distance is a linear cutoff, so it stays
 * separate from the package's generic never-zero `spatialise` contract.
 */
export const minecraftSpatialise = (
  listener: Position,
  source: Position,
  options: SpatialisationOptions = {},
): Spatialisation => {
  const { distance, distanceScale, pan } = resolveSpatialCoordinates(listener, source, options)

  return {
    gain: clamp01(UNITY_GAIN - distance / distanceScale),
    pan,
  }
}

/** Non-spatial sounds are heard at full amplitude, dead centre. */
export const NO_SPATIALISATION: Spatialisation = { gain: audioVolume(UNITY_GAIN), pan: audioPan(CENTER_PAN) }

/**
 * Per-cue gain for a sound effect. Master is deliberately absent — see the
 * module header.
 *
 * Reference: `packages/game/application/sound-manager-playback.ts:31-36`.
 */
const MIN_GAIN_SCALE = 0

export const effectiveSfxGain = (input: {
  readonly baseGain: AudioGain
  readonly sfxVolume: AudioVolume
  readonly spatialGain: AudioVolume
  readonly gainScale?: AudioGain
}): AudioGain =>
  clampNonNegative(
    input.baseGain *
      input.sfxVolume *
      input.spatialGain *
      Math.max(MIN_GAIN_SCALE, input.gainScale ?? UNITY_GAIN),
  )

/**
 * Per-track gain for music. Master is deliberately absent — see the module header.
 *
 * Reference: `packages/game/application/music-manager-runtime.ts:70-71`.
 */
export const effectiveMusicGain = (input: {
  readonly baseGain: AudioGain
  readonly musicVolume: AudioVolume
}): AudioGain => clampNonNegative(input.baseGain * input.musicVolume)

/**
 * The gain the backend's master node should carry.
 *
 * A named function rather than a bare `clamp01(settings.master)` so that the
 * "applied once, here and nowhere else" contract has somewhere to be stated and
 * somewhere to be tested.
 */
export const masterNodeGain = (settings: VolumeSettings): AudioVolume => clamp01(settings.master)

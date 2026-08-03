/**
 * Volume categories and the gain arithmetic.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
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

/** The three categories a player can set independently. */
export const VOLUME_CATEGORIES = ['master', 'sfx', 'music'] as const

export type VolumeCategory = (typeof VOLUME_CATEGORIES)[number]

export type VolumeSettings = {
  readonly [Category in VolumeCategory]: number
}

/**
 * Reference-implementation defaults, carried over deliberately.
 * `packages/game/application/settings-service.ts:35-37`.
 *
 * Music sits well below sfx because it is continuous while sfx are transient;
 * equal nominal levels make music dominate perceptually.
 */
export const DEFAULT_VOLUME_SETTINGS: VolumeSettings = {
  master: 0.8,
  sfx: 1,
  music: 0.55,
}

export const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0

export const clampPan = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0

/**
 * Distance at which a sound is attenuated to half amplitude, in blocks.
 * `SPATIAL_DISTANCE_SCALE` in `packages/game/domain/sound-spatial.ts:11`.
 */
export const SPATIAL_DISTANCE_SCALE = 12

export type Vec3 = {
  readonly x: number
  readonly y: number
  readonly z: number
}

export type Spatialisation = {
  /** Multiplicative attenuation in [0, 1]. */
  readonly gain: number
  /** Stereo position in [-1, 1]; negative is left. */
  readonly pan: number
}

/**
 * Attenuation and panning for a sound at `source` heard from `listener`.
 *
 * `1 / (1 + d / scale)` rather than inverse-square: it never reaches zero, so a
 * distant sound fades out instead of cutting off, and it is finite at d = 0.
 * Reference: `packages/game/domain/sound-spatial.ts:11-27`.
 */
export const spatialise = (
  listener: Vec3,
  source: Vec3,
  listenerForward: Vec3 = { x: 0, y: 0, z: -1 },
): Spatialisation => {
  const dx = source.x - listener.x
  const dy = source.y - listener.y
  const dz = source.z - listener.z
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const horizontalForwardLength = Math.sqrt(
    listenerForward.x * listenerForward.x + listenerForward.z * listenerForward.z,
  )
  const hasUsableForward =
    Number.isFinite(horizontalForwardLength) && horizontalForwardLength > 0
  const rightX = hasUsableForward ? -listenerForward.z / horizontalForwardLength : 1
  const rightZ = hasUsableForward ? listenerForward.x / horizontalForwardLength : 0

  return {
    gain: 1 / (1 + distance / SPATIAL_DISTANCE_SCALE),
    pan: clampPan((dx * rightX + dz * rightZ) / SPATIAL_DISTANCE_SCALE),
  }
}

/** Non-spatial sounds are heard at full amplitude, dead centre. */
export const NO_SPATIALISATION: Spatialisation = { gain: 1, pan: 0 }

/**
 * Per-cue gain for a sound effect. Master is deliberately absent — see the
 * module header.
 *
 * Reference: `packages/game/application/sound-manager-playback.ts:31-36`.
 */
export const effectiveSfxGain = (input: {
  readonly baseGain: number
  readonly sfxVolume: number
  readonly spatialGain: number
  readonly gainScale?: number
}): number =>
  clamp01(input.baseGain * input.sfxVolume * input.spatialGain * Math.max(0, input.gainScale ?? 1))

/**
 * Per-track gain for music. Master is deliberately absent — see the module header.
 *
 * Reference: `packages/game/application/music-manager-runtime.ts:70-71`.
 */
export const effectiveMusicGain = (input: {
  readonly baseGain: number
  readonly musicVolume: number
}): number => clamp01(input.baseGain * input.musicVolume)

/**
 * The gain the backend's master node should carry.
 *
 * A named function rather than a bare `clamp01(settings.master)` so that the
 * "applied once, here and nowhere else" contract has somewhere to be stated and
 * somewhere to be tested.
 */
export const masterNodeGain = (settings: VolumeSettings): number => clamp01(settings.master)

/**
 * The BGM state machine.
 *
 * Boundary and provenance notes.
 *
 * Ported in shape from the reference implementation's music manager, whose
 * best property is that the decision is a pure function returning a plan
 * (`packages/game/application/music-manager-state.ts:21-43`) and the effectful
 * driver merely applies it (`music-manager-runtime.ts:48-82`). That split is
 * why its transition table could be tested exhaustively in 54 lines
 * (`packages/game/test/music-manager-state.test.ts`) with no audio anywhere.
 *
 * The behaviour worth preserving exactly: **the same environment already
 * playing produces no action at all.** Restarting the track every frame because
 * the environment "changed" from `day` to `day` is the obvious bug here, and
 * it is silent — you would hear a permanently retriggering note, not an error.
 */
import { clamp01, effectiveMusicGain } from './volume.js'
import { Option } from 'effect'
import type { Position } from '@nerima-games/mc-kernel'

export const MUSIC_ENVIRONMENTS = ['day', 'night', 'cave'] as const

export type MusicEnvironment = (typeof MUSIC_ENVIRONMENTS)[number]

/**
 * Below this Y, the player is "in a cave" for music purposes.
 * `DEFAULT_CAVE_THRESHOLD_Y = 40` in
 * `packages/game/application/music-manager.config.ts:15`.
 *
 * Note this sits below `SEA_LEVEL = 63` (mc-worldgen's corrected constant), so
 * a player standing on a beach is never accidentally underground.
 */
export const DEFAULT_CAVE_THRESHOLD_Y = 40

export type MusicEnvironmentContext = {
  readonly playerPosition: Position
  readonly isNight: boolean
  readonly caveThresholdY?: number
}

/**
 * Cave wins over day/night, and the comparison is strict `<`.
 *
 * The strictness is load-bearing and the reference has a dedicated test for the
 * boundary (`packages/game/test/music-manager-environment.test.ts` — "exactly at
 * caveThresholdY (below = <, not <=)"). A player standing exactly on the
 * threshold flickering between cave and surface music every time they walk over
 * a one-block step is the failure this pins shut.
 */
export const resolveMusicEnvironment = (context: MusicEnvironmentContext): MusicEnvironment => {
  const threshold = context.caveThresholdY ?? DEFAULT_CAVE_THRESHOLD_Y
  if (context.playerPosition.y < threshold) {
    return 'cave'
  }
  if (context.isNight) {
    return 'night'
  }
  return 'day'
}

export type MusicTrack = {
  readonly frequency: number
  readonly baseGain: number
}

/** `TRACKS` in `packages/game/application/music-manager.config.ts:9-13`. */
export const MUSIC_TRACKS: Record<MusicEnvironment, MusicTrack> = {
  cave: { baseGain: 0.2, frequency: 98 },
  day: { baseGain: 0.28, frequency: 174.61 },
  night: { baseGain: 0.24, frequency: 130.81 },
}

export type MusicPlan = {
  readonly shouldStopActiveTrack: boolean
  readonly environmentToPlay: Option.Option<MusicEnvironment>
}

/**
 * What to do, given what is playing and what should be.
 *
 * `resolveMusicPlan` is total and has exactly four outcomes; the test file
 * enumerates all four. Note that "disabled" stops the active track rather than
 * merely declining to start a new one — otherwise turning music off mid-track
 * leaves the current one looping forever
 * (`music-manager-runtime.ts:85-95` handles this).
 */
export const resolveMusicPlan = (input: {
  readonly enabled: boolean
  readonly active: Option.Option<MusicEnvironment>
  readonly desired: MusicEnvironment
}): MusicPlan => {
  if (!input.enabled) {
    return {
      environmentToPlay: Option.none(),
      shouldStopActiveTrack: Option.isSome(input.active),
    }
  }

  if (Option.isSome(input.active) && input.active.value === input.desired) {
    return { environmentToPlay: Option.none(), shouldStopActiveTrack: false }
  }

  return {
    environmentToPlay: Option.some(input.desired),
    shouldStopActiveTrack: Option.isSome(input.active),
  }
}

/**
 * Gain for a music track. Master is deliberately absent — the backend's master
 * node applies it once. See `domain/volume.ts`.
 */
export const musicTrackGain = (environment: MusicEnvironment, musicVolume: number): number =>
  effectiveMusicGain({
    baseGain: MUSIC_TRACKS[environment].baseGain,
    musicVolume: clamp01(musicVolume),
  })

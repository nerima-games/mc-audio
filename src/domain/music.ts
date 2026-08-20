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
import {
  MUSIC_ENVIRONMENTS,
  MUSIC_TRACKS,
  type MusicEnvironment,
  type MusicTrack,
} from '../data/music-tracks.js'
import { clamp01, effectiveMusicGain } from './volume.js'
import { Option } from 'effect'
import type { Position } from '@nerima-games/mc-kernel'

export { MUSIC_ENVIRONMENTS, MUSIC_TRACKS }
export type { MusicEnvironment, MusicTrack }

export const DEFAULT_CAVE_THRESHOLD_Y = 40

export type MusicEnvironmentContext = {
  readonly playerPosition: Position
  readonly isNight: boolean
  readonly caveThresholdY?: number
}

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

export type MusicPlan = {
  readonly shouldStopActiveTrack: boolean
  readonly environmentToPlay: Option.Option<MusicEnvironment>
}

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

export const musicTrackGain = (environment: MusicEnvironment, musicVolume: number): number =>
  effectiveMusicGain({
    baseGain: MUSIC_TRACKS[environment].baseGain,
    musicVolume: clamp01(musicVolume),
  })

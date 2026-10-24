import {
  type AudioDelayTicks,
  type AudioTick,
  type AudioVolume,
  type MinecraftSoundEventId,
  AudioDiagnosticMessage as makeAudioDiagnosticMessage,
  AudioDiagnosticPath as makeAudioDiagnosticPath,
  AudioTick as makeAudioTick,
  AudioVolume as makeAudioVolume,
} from './audio-brands.js'
import {
  MINECRAFT_MUSIC_GAIN_STEP,
  MINECRAFT_MUSIC_STARTING_DELAY_TICKS,
  type MinecraftMusicDataFailure,
  type MinecraftMusicDefinition,
  type NormalizedMinecraftMusicDefinition,
  normalizeMinecraftMusicDefinition,
} from './minecraft-music-data.js'
import { Result } from 'effect'
import { clamp01 } from './volume.js'

const ZERO_TICKS = 0
const ZERO_VOLUME = 0
const ONE_TICK = 1

export type MinecraftMusicState = {
  readonly currentSound: MinecraftSoundEventId | null
  readonly currentGain: AudioVolume
  readonly nextSongDelayTicks: AudioTick
}

export const initialMinecraftMusicState = (): MinecraftMusicState => ({
  currentGain: makeAudioVolume(ZERO_VOLUME),
  currentSound: null,
  nextSongDelayTicks: makeAudioTick(MINECRAFT_MUSIC_STARTING_DELAY_TICKS),
})

export type MinecraftMusicCommand =
  | { readonly kind: 'stop' }
  | { readonly kind: 'start'; readonly definition: NormalizedMinecraftMusicDefinition; readonly gain: AudioVolume }
  | { readonly kind: 'gain'; readonly gain: AudioVolume }

export type MinecraftMusicPlan = {
  readonly commands: readonly MinecraftMusicCommand[]
  readonly state: MinecraftMusicState
}

export type MinecraftMusicPlannerInput = {
  readonly currentActive: boolean
  readonly desired: MinecraftMusicDefinition | null
  readonly enabled: boolean
  readonly musicVolume: AudioVolume
  readonly randomIntInclusive: (min: AudioDelayTicks, max: AudioDelayTicks) => unknown
  readonly state: MinecraftMusicState
}

const dataFailure = (path: string, message: string): MinecraftMusicDataFailure => ({
  _tag: 'MinecraftMusicDataFailure',
  message: makeAudioDiagnosticMessage(message),
  path: makeAudioDiagnosticPath(path),
})

const delayFor = (
  definition: NormalizedMinecraftMusicDefinition,
  randomIntInclusive: (min: AudioDelayTicks, max: AudioDelayTicks) => unknown,
): Result.Result<AudioTick, MinecraftMusicDataFailure> => {
  const sample = randomIntInclusive(definition.min_delay, definition.max_delay)
  let bounded: number = definition.min_delay
  if (typeof sample === 'number' && Number.isFinite(sample)) {
    bounded = Math.trunc(sample)
  }
  const delay = Math.min(definition.max_delay, Math.max(definition.min_delay, bounded))
  return Result.succeed(makeAudioTick(delay))
}

const gainStep = (
  current: AudioVolume,
  target: AudioVolume,
): Result.Result<AudioVolume, MinecraftMusicDataFailure> => {
  let next: number = current
  if (current < target) {
    next = Math.min(target, current + MINECRAFT_MUSIC_GAIN_STEP)
  } else if (current > target) {
    next = Math.max(target, current - MINECRAFT_MUSIC_GAIN_STEP)
  } else {
    next = current
  }
  return Result.mapError(makeAudioVolume.result(next), (error) => dataFailure('currentGain', error.message))
}

const resetState = (): MinecraftMusicState => initialMinecraftMusicState()

const planGain = (
  state: MinecraftMusicState,
  targetGain: AudioVolume,
): Result.Result<MinecraftMusicPlan, MinecraftMusicDataFailure> =>
  Result.map(gainStep(state.currentGain, targetGain), (nextGain) => {
    let commands: readonly MinecraftMusicCommand[] = []
    if (nextGain !== state.currentGain) {
      commands = [{ gain: nextGain, kind: 'gain' }]
    }
    return {
      commands,
      state: { ...state, currentGain: nextGain },
    }
  })

const planDisabled = (state: MinecraftMusicState): MinecraftMusicPlan => {
  let commands: readonly MinecraftMusicCommand[] = []
  if (state.currentSound !== null) {
    commands = [{ kind: 'stop' }]
  }
  return { commands, state: resetState() }
}

const planInactive = (
  desired: NormalizedMinecraftMusicDefinition,
  randomIntInclusive: (min: AudioDelayTicks, max: AudioDelayTicks) => unknown,
): Result.Result<MinecraftMusicPlan, MinecraftMusicDataFailure> =>
  Result.map(delayFor(desired, randomIntInclusive), (delay) => ({
    commands: [],
    state: { ...resetState(), nextSongDelayTicks: delay },
  }))

const planReplacement = (
  desired: NormalizedMinecraftMusicDefinition,
  targetGain: AudioVolume,
  randomIntInclusive: (min: AudioDelayTicks, max: AudioDelayTicks) => unknown,
): Result.Result<MinecraftMusicPlan, MinecraftMusicDataFailure> =>
  Result.map(delayFor(desired, randomIntInclusive), (delay) => ({
    commands: [
      { kind: 'stop' },
      { definition: desired, gain: targetGain, kind: 'start' },
    ],
    state: {
      currentGain: targetGain,
      currentSound: desired.sound,
      nextSongDelayTicks: delay,
    },
  }))

const planDelay = (state: MinecraftMusicState): Result.Result<MinecraftMusicPlan, MinecraftMusicDataFailure> =>
  Result.mapError(
    Result.map(makeAudioTick.result(state.nextSongDelayTicks - ONE_TICK), (nextSongDelayTicks) => ({
      commands: [],
      state: { ...state, nextSongDelayTicks },
    })),
    (error) => dataFailure('nextSongDelayTicks', error.message),
  )

const planStart = (
  desired: NormalizedMinecraftMusicDefinition,
  targetGain: AudioVolume,
  randomIntInclusive: (min: AudioDelayTicks, max: AudioDelayTicks) => unknown,
): Result.Result<MinecraftMusicPlan, MinecraftMusicDataFailure> =>
  Result.map(delayFor(desired, randomIntInclusive), (delay) => ({
    commands: [{ definition: desired, gain: targetGain, kind: 'start' }],
    state: {
      currentGain: targetGain,
      currentSound: desired.sound,
      nextSongDelayTicks: delay,
    },
  }))

const normalizeDesired = (
  desired: MinecraftMusicDefinition | null,
): Result.Result<NormalizedMinecraftMusicDefinition | null, MinecraftMusicDataFailure> => {
  if (desired === null) {
    return Result.succeed(null)
  }
  return normalizeMinecraftMusicDefinition(desired)
}

type AvailableMusicPlanOptions = {
  readonly desired: NormalizedMinecraftMusicDefinition
  readonly randomIntInclusive: (min: AudioDelayTicks, max: AudioDelayTicks) => unknown
  readonly state: MinecraftMusicState
  readonly targetGain: AudioVolume
}

const planCurrentMusic = ({
  desired,
  randomIntInclusive,
  state,
  targetGain,
}: AvailableMusicPlanOptions): Result.Result<MinecraftMusicPlan, MinecraftMusicDataFailure> => {
  if (state.currentSound !== desired.sound && desired.replace_current_music === true) {
    return planReplacement(desired, targetGain, randomIntInclusive)
  }
  return planGain(state, targetGain)
}

const planAvailableMusic = (
  options: AvailableMusicPlanOptions,
): Result.Result<MinecraftMusicPlan, MinecraftMusicDataFailure> => {
  if (options.state.currentSound !== null) {
    return planCurrentMusic(options)
  }
  if (options.state.nextSongDelayTicks > ZERO_TICKS) {
    return planDelay(options.state)
  }
  return planStart(options.desired, options.targetGain, options.randomIntInclusive)
}

/**
 * Reproduces the useful part of Minecraft's MusicManager as a pure tick.
 * `nextSongDelayTicks` is decremented once per game tick, and a selected track
 * is allowed to finish unless its replacement explicitly opts in.
 */
export const planMinecraftMusic = (
  input: MinecraftMusicPlannerInput,
): Result.Result<MinecraftMusicPlan, MinecraftMusicDataFailure> => Result.gen(function* planMinecraftMusicEffect() {
  const desired = yield* normalizeDesired(input.desired)
  if (!input.enabled || desired === null) {
    return planDisabled(input.state)
  }

  if (input.state.currentSound !== null && !input.currentActive) {
    return yield* planInactive(desired, input.randomIntInclusive)
  }

  const targetGain = clamp01(input.musicVolume)
  return yield* planAvailableMusic({
    desired,
    randomIntInclusive: input.randomIntInclusive,
    state: input.state,
    targetGain,
  })
})

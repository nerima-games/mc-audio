import {
  MINECRAFT_MUSIC_GAIN_STEP,
  MINECRAFT_MUSIC_STARTING_DELAY_TICKS,
  type MinecraftMusicDefinition,
  type NormalizedMinecraftMusicDefinition,
  normalizeMinecraftMusicDefinition,
} from './minecraft-music-data.js'
import { clamp01 } from './volume.js'

const ZERO_TICKS = 0
const ONE_TICK = 1

export type MinecraftMusicState = {
  readonly currentSound: string | null
  readonly currentGain: number
  readonly nextSongDelayTicks: number
}

export const initialMinecraftMusicState = (): MinecraftMusicState => ({
  currentGain: 0,
  currentSound: null,
  nextSongDelayTicks: MINECRAFT_MUSIC_STARTING_DELAY_TICKS,
})

export type MinecraftMusicCommand =
  | { readonly kind: 'stop' }
  | { readonly kind: 'start'; readonly definition: NormalizedMinecraftMusicDefinition; readonly gain: number }
  | { readonly kind: 'gain'; readonly gain: number }

export type MinecraftMusicPlan = {
  readonly commands: readonly MinecraftMusicCommand[]
  readonly state: MinecraftMusicState
}

export type MinecraftMusicPlannerInput = {
  readonly currentActive: boolean
  readonly desired: MinecraftMusicDefinition | null
  readonly enabled: boolean
  readonly musicVolume: number
  readonly randomIntInclusive: (min: number, max: number) => number
  readonly state: MinecraftMusicState
}

const delayFor = (
  definition: NormalizedMinecraftMusicDefinition,
  randomIntInclusive: (min: number, max: number) => number,
): number => {
  const sample = randomIntInclusive(definition.min_delay, definition.max_delay)
  let bounded = definition.min_delay
  if (Number.isFinite(sample)) {
    bounded = Math.trunc(sample)
  }
  return Math.min(definition.max_delay, Math.max(definition.min_delay, bounded))
}

const gainStep = (current: number, target: number): number => {
  if (current < target) {
    return Math.min(target, current + MINECRAFT_MUSIC_GAIN_STEP)
  }
  if (current > target) {
    return Math.max(target, current - MINECRAFT_MUSIC_GAIN_STEP)
  }
  return current
}

const resetState = (): MinecraftMusicState => initialMinecraftMusicState()

const planGain = (state: MinecraftMusicState, targetGain: number): MinecraftMusicPlan => {
  const nextGain = gainStep(state.currentGain, targetGain)
  let commands: readonly MinecraftMusicCommand[] = []
  if (nextGain !== state.currentGain) {
    commands = [{ gain: nextGain, kind: 'gain' }]
  }
  return {
    commands,
    state: { ...state, currentGain: nextGain },
  }
}

const planDisabled = (state: MinecraftMusicState): MinecraftMusicPlan => {
  let commands: readonly MinecraftMusicCommand[] = []
  if (state.currentSound !== null) {
    commands = [{ kind: 'stop' }]
  }
  return { commands, state: resetState() }
}

const planInactive = (
  desired: NormalizedMinecraftMusicDefinition,
  randomIntInclusive: (min: number, max: number) => number,
): MinecraftMusicPlan => ({
  commands: [],
  state: { ...resetState(), nextSongDelayTicks: delayFor(desired, randomIntInclusive) },
})

const planReplacement = (
  desired: NormalizedMinecraftMusicDefinition,
  targetGain: number,
  randomIntInclusive: (min: number, max: number) => number,
): MinecraftMusicPlan => ({
  commands: [
    { kind: 'stop' },
    { definition: desired, gain: targetGain, kind: 'start' },
  ],
  state: {
    currentGain: targetGain,
    currentSound: desired.sound,
    nextSongDelayTicks: delayFor(desired, randomIntInclusive),
  },
})

const planDelay = (state: MinecraftMusicState): MinecraftMusicPlan => ({
  commands: [],
  state: { ...state, nextSongDelayTicks: state.nextSongDelayTicks - ONE_TICK },
})

const planStart = (
  desired: NormalizedMinecraftMusicDefinition,
  targetGain: number,
  randomIntInclusive: (min: number, max: number) => number,
): MinecraftMusicPlan => ({
  commands: [{ definition: desired, gain: targetGain, kind: 'start' }],
  state: {
    currentGain: targetGain,
    currentSound: desired.sound,
    nextSongDelayTicks: delayFor(desired, randomIntInclusive),
  },
})

const normalizeDesired = (
  desired: MinecraftMusicDefinition | null,
): NormalizedMinecraftMusicDefinition | null => {
  if (desired === null) {
    return null
  }
  return normalizeMinecraftMusicDefinition(desired)
}

type AvailableMusicPlanOptions = {
  readonly desired: NormalizedMinecraftMusicDefinition
  readonly randomIntInclusive: (min: number, max: number) => number
  readonly state: MinecraftMusicState
  readonly targetGain: number
}

const planCurrentMusic = ({
  desired,
  randomIntInclusive,
  state,
  targetGain,
}: AvailableMusicPlanOptions): MinecraftMusicPlan => {
  if (state.currentSound !== desired.sound && desired.replace_current_music === true) {
    return planReplacement(desired, targetGain, randomIntInclusive)
  }
  return planGain(state, targetGain)
}

const planAvailableMusic = (options: AvailableMusicPlanOptions): MinecraftMusicPlan => {
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
export const planMinecraftMusic = (input: MinecraftMusicPlannerInput): MinecraftMusicPlan => {
  const desired = normalizeDesired(input.desired)
  if (!input.enabled || desired === null) {
    return planDisabled(input.state)
  }

  if (input.state.currentSound !== null && !input.currentActive) {
    return planInactive(desired, input.randomIntInclusive)
  }

  return planAvailableMusic({
    desired,
    randomIntInclusive: input.randomIntInclusive,
    state: input.state,
    targetGain: clamp01(input.musicVolume),
  })
}

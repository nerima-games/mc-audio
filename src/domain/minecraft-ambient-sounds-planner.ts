import {
  type MinecraftAmbientAddition,
  type MinecraftAmbientMood,
  type MinecraftAmbientSoundsDefinition,
  normalizeMinecraftAmbientSoundsDefinition,
} from './minecraft-ambient-sounds-data.js'
import type { Position } from '@nerima-games/mc-kernel'

const ZERO = 0
const ONE = 1
const MAX_RANDOM = ONE - Number.EPSILON
const MIN_MOOD_DELAY = 1

export type MinecraftAmbientSoundsState = {
  readonly loopSound: string | null
  readonly nextMoodTick: number
}

export const initialMinecraftAmbientSoundsState = (): MinecraftAmbientSoundsState => ({
  loopSound: null,
  nextMoodTick: ZERO,
})

export type MinecraftAmbientSoundsCommand =
  | { readonly kind: 'stop-loop' }
  | { readonly kind: 'start-loop'; readonly sound: string }
  | {
      readonly kind: 'play'
      readonly category: 'mood'
      readonly offset: number
      readonly sound: string
      readonly position: Position
    }
  | { readonly kind: 'play'; readonly category: 'addition'; readonly sound: string }

export type MinecraftAmbientSoundsPlan = {
  readonly commands: readonly MinecraftAmbientSoundsCommand[]
  readonly state: MinecraftAmbientSoundsState
}

export type MinecraftAmbientMoodResolution = {
  readonly delayTicks: number
  readonly position: Position | null
}

export type MinecraftAmbientMoodResolverInput = {
  readonly cameraPosition: Position
  readonly mood: MinecraftAmbientMood
  readonly randomSource: () => number
  readonly tick: number
}

export type MinecraftAmbientMoodResolver = (
  input: MinecraftAmbientMoodResolverInput,
) => MinecraftAmbientMoodResolution | null

export type MinecraftAmbientSoundsPlannerInput = {
  readonly cameraPosition: Position
  readonly definition?: MinecraftAmbientSoundsDefinition | null
  readonly moodResolver?: MinecraftAmbientMoodResolver
  readonly randomSource: () => number
  readonly state: MinecraftAmbientSoundsState
  readonly tick: number
}

const randomUnit = (randomSource: () => number): number => {
  const value = randomSource()
  if (!Number.isFinite(value)) {
    return ZERO
  }
  return Math.min(MAX_RANDOM, Math.max(ZERO, value))
}

const validTick = (tick: number): number => {
  if (!Number.isInteger(tick) || tick < ZERO) {
    throw new RangeError('Minecraft ambient sounds tick must be a non-negative integer')
  }
  return tick
}

const planLoopCommands = (
  currentLoop: string | null,
  desiredLoop: string | null,
): readonly MinecraftAmbientSoundsCommand[] => {
  const commands: MinecraftAmbientSoundsCommand[] = []
  if (currentLoop !== desiredLoop) {
    if (currentLoop !== null) {
      commands.push({ kind: 'stop-loop' })
    }
    if (desiredLoop !== null) {
      commands.push({ kind: 'start-loop', sound: desiredLoop })
    }
  }
  return commands
}

type MoodPlanInput = {
  readonly cameraPosition: Position
  readonly mood: MinecraftAmbientMood | null
  readonly moodResolver: MinecraftAmbientMoodResolver | undefined
  readonly randomSource: () => number
  readonly nextMoodTick: number
  readonly tick: number
}

type MoodPlan = {
  readonly commands: readonly MinecraftAmbientSoundsCommand[]
  readonly nextMoodTick: number
}

const moodCommand = (
  mood: MinecraftAmbientMood,
  resolution: MinecraftAmbientMoodResolution | null,
): readonly MinecraftAmbientSoundsCommand[] => {
  if (resolution === null || resolution.position === null) {
    return []
  }
  return [
    {
      category: 'mood',
      kind: 'play',
      offset: mood.offset,
      position: resolution.position,
      sound: mood.sound,
    },
  ]
}

const moodDelay = (mood: MinecraftAmbientMood, resolution: MinecraftAmbientMoodResolution | null): number => {
  const delayTicks = resolution?.delayTicks ?? mood.tick_delay
  if (!Number.isInteger(delayTicks) || delayTicks < MIN_MOOD_DELAY) {
    throw new RangeError('Minecraft ambient mood delayTicks must be a positive integer')
  }
  return delayTicks
}

const planMoodCommands = ({
  cameraPosition,
  mood,
  moodResolver,
  randomSource,
  nextMoodTick,
  tick,
}: MoodPlanInput): MoodPlan => {
  if (mood === null) {
    return { commands: [], nextMoodTick: ZERO }
  }
  if (tick < nextMoodTick) {
    return { commands: [], nextMoodTick }
  }

  const resolution = moodResolver?.({ cameraPosition, mood, randomSource, tick }) ?? null
  return {
    commands: moodCommand(mood, resolution),
    nextMoodTick: tick + moodDelay(mood, resolution),
  }
}

const shouldPlayAddition = (
  addition: MinecraftAmbientAddition,
  randomSource: () => number,
): boolean => {
  if (addition.tick_chance === ONE) {
    return true
  }
  if (addition.tick_chance === ZERO) {
    return false
  }
  return randomUnit(randomSource) < addition.tick_chance
}

const planAdditionCommands = (input: {
  readonly additions: readonly MinecraftAmbientAddition[]
  readonly randomSource: () => number
}): readonly MinecraftAmbientSoundsCommand[] => {
  const commands: MinecraftAmbientSoundsCommand[] = []
  for (const addition of input.additions) {
    if (shouldPlayAddition(addition, input.randomSource)) {
      commands.push({ category: 'addition', kind: 'play', sound: addition.sound })
    }
  }
  return commands
}

export const planMinecraftAmbientSounds = ({
  cameraPosition,
  definition,
  moodResolver,
  randomSource,
  state,
  tick,
}: MinecraftAmbientSoundsPlannerInput): MinecraftAmbientSoundsPlan => {
  const normalized = normalizeMinecraftAmbientSoundsDefinition(definition)
  const currentTick = validTick(tick)
  const { loopSound, nextMoodTick } = state
  const loopCommands = planLoopCommands(loopSound, normalized.loop)
  const moodPlan = planMoodCommands({
    cameraPosition,
    mood: normalized.mood,
    moodResolver,
    nextMoodTick,
    randomSource,
    tick: currentTick,
  })
  const additionCommands = planAdditionCommands({
    additions: normalized.additions,
    randomSource,
  })

  return {
    commands: [...loopCommands, ...moodPlan.commands, ...additionCommands],
    state: { loopSound: normalized.loop, nextMoodTick: moodPlan.nextMoodTick },
  }
}

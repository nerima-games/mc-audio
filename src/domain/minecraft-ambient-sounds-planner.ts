import {
  type AudioDiagnosticMessage,
  type AudioDelayTicks,
  type AudioOffset,
  type AudioTick,
  type MinecraftSoundEventId,
  AudioDiagnosticMessage as makeAudioDiagnosticMessage,
  AudioDelayTicks as makeAudioDelayTicks,
  AudioTick as makeAudioTick,
} from './audio-brands.js'
import {
  type MinecraftAmbientAddition,
  type MinecraftAmbientMood,
  type MinecraftAmbientSoundsDefinition,
  type MinecraftAmbientSoundsFailure,
  normalizeMinecraftAmbientSoundsDefinition,
} from './minecraft-ambient-sounds-data.js'
import type { Position } from '@nerima-games/mc-kernel/domain/coordinates'
import { Result } from 'effect'

const ZERO = 0
const ONE = 1
const MAX_RANDOM = ONE - Number.EPSILON
const MIN_MOOD_DELAY = 1

export type MinecraftAmbientSoundsPlannerFailure = {
  readonly _tag: 'MinecraftAmbientSoundsPlannerFailure'
  readonly message: AudioDiagnosticMessage
}

export type MinecraftAmbientSoundsState = {
  readonly loopSound: MinecraftSoundEventId | null
  readonly nextMoodTick: AudioTick
}

export const initialMinecraftAmbientSoundsState = (): MinecraftAmbientSoundsState => ({
  loopSound: null,
  nextMoodTick: makeAudioTick(ZERO),
})

export type MinecraftAmbientSoundsCommand =
  | { readonly kind: 'stop-loop' }
  | { readonly kind: 'start-loop'; readonly sound: MinecraftSoundEventId }
  | {
      readonly kind: 'play'
      readonly category: 'mood'
      readonly offset: AudioOffset
      readonly sound: MinecraftSoundEventId
      readonly position: Position
    }
  | { readonly kind: 'play'; readonly category: 'addition'; readonly sound: MinecraftSoundEventId }

export type MinecraftAmbientSoundsPlan = {
  readonly commands: readonly MinecraftAmbientSoundsCommand[]
  readonly state: MinecraftAmbientSoundsState
}

export type MinecraftAmbientMoodResolution = {
  readonly delayTicks: AudioDelayTicks
  readonly position: Position | null
}

export type MinecraftAmbientMoodResolverInput = {
  readonly cameraPosition: Position
  readonly mood: MinecraftAmbientMood
  readonly randomSource: () => unknown
  readonly tick: AudioTick
}

export type MinecraftAmbientMoodResolver = (
  input: MinecraftAmbientMoodResolverInput,
) => MinecraftAmbientMoodResolution | null

export type MinecraftAmbientSoundsPlannerInput = {
  readonly cameraPosition: Position
  readonly definition?: MinecraftAmbientSoundsDefinition | null
  readonly moodPosition: Position | null
  readonly moodResolver?: MinecraftAmbientMoodResolver
  readonly randomSource: () => unknown
  readonly state: MinecraftAmbientSoundsState
  readonly tick: AudioTick
}

const randomUnit = (randomSource: () => unknown): number => {
  const value = randomSource()
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ZERO
  }
  return Math.min(MAX_RANDOM, Math.max(ZERO, value))
}

const validTick = (tick: AudioTick): Result.Result<AudioTick, MinecraftAmbientSoundsPlannerFailure> =>
  Result.mapError(makeAudioTick.result(tick), (error) => ({
    _tag: 'MinecraftAmbientSoundsPlannerFailure',
    message: makeAudioDiagnosticMessage(error.message),
  }))

const planLoopCommands = (
  currentLoop: MinecraftSoundEventId | null,
  desiredLoop: MinecraftSoundEventId | null,
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
  readonly moodPosition: Position | null
  readonly moodResolver: MinecraftAmbientMoodResolver | undefined
  readonly randomSource: () => unknown
  readonly nextMoodTick: AudioTick
  readonly tick: AudioTick
}

type MoodPlan = {
  readonly commands: readonly MinecraftAmbientSoundsCommand[]
  readonly nextMoodTick: AudioTick
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

const moodDelay = (resolution: MinecraftAmbientMoodResolution): Result.Result<AudioDelayTicks, MinecraftAmbientSoundsPlannerFailure> => {
  const { delayTicks } = resolution
  if (!Number.isInteger(delayTicks) || delayTicks < MIN_MOOD_DELAY) {
    return Result.fail({
      _tag: 'MinecraftAmbientSoundsPlannerFailure',
      message: makeAudioDiagnosticMessage('Minecraft ambient mood delayTicks must be a positive integer'),
    })
  }
  return Result.succeed(makeAudioDelayTicks(delayTicks))
}

const planMoodCommands = ({
  cameraPosition,
  mood,
  moodPosition,
  moodResolver,
  randomSource,
  nextMoodTick,
  tick,
}: MoodPlanInput): Result.Result<MoodPlan, MinecraftAmbientSoundsPlannerFailure> => {
  if (mood === null) {
    return Result.succeed({ commands: [], nextMoodTick: makeAudioTick(ZERO) })
  }
  if (tick < nextMoodTick) {
    return Result.succeed({ commands: [], nextMoodTick })
  }

  const resolution = moodResolver?.({ cameraPosition, mood, randomSource, tick }) ?? {
    delayTicks: mood.tick_delay,
    position: moodPosition ?? null,
  }
  return Result.gen(function* planMoodCommandsEffect() {
    const delayTicks = yield* moodDelay(resolution)
    const nextTick = yield* Result.mapError(makeAudioTick.result(tick + delayTicks), (error) => ({
      _tag: 'MinecraftAmbientSoundsPlannerFailure' as const,
      message: makeAudioDiagnosticMessage(error.message),
    }))
    return { commands: moodCommand(mood, resolution), nextMoodTick: nextTick }
  })
}

const shouldPlayAddition = (
  addition: MinecraftAmbientAddition,
  randomSource: () => unknown,
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
  readonly randomSource: () => unknown
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
  moodPosition,
  moodResolver,
  randomSource,
  state,
  tick,
}: MinecraftAmbientSoundsPlannerInput): Result.Result<
  MinecraftAmbientSoundsPlan,
  MinecraftAmbientSoundsFailure | MinecraftAmbientSoundsPlannerFailure
> => Result.gen(function* planMinecraftAmbientSoundsEffect() {
  const normalized = yield* normalizeMinecraftAmbientSoundsDefinition(definition)
  const currentTick = yield* validTick(tick)
  const { loopSound, nextMoodTick } = state
  const loopCommands = planLoopCommands(loopSound, normalized.loop)
  const moodPlan = yield* planMoodCommands({
    cameraPosition,
    mood: normalized.mood,
    moodPosition,
    moodResolver,
    nextMoodTick,
    randomSource,
    tick: currentTick,
  })
  const additionCommands = planAdditionCommands({ additions: normalized.additions, randomSource })
  return {
    commands: [...loopCommands, ...moodPlan.commands, ...additionCommands],
    state: { loopSound: normalized.loop, nextMoodTick: moodPlan.nextMoodTick },
  }
})

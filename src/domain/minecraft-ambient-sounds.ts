import type { Position } from '@nerima-games/mc-kernel'

const ZERO = 0
const ONE = 1
const MIN_TICK_DELAY = 1
const MAX_RANDOM = ONE - Number.EPSILON
const AMBIENT_SOUND_KEYS = ['additions', 'loop', 'mood'] as const
const AMBIENT_MOOD_KEYS = ['block_search_extent', 'offset', 'sound', 'tick_delay'] as const
const AMBIENT_ADDITION_KEYS = ['sound', 'tick_chance'] as const

const isMissing = (value: unknown): value is undefined => Object.is(value, globalThis.undefined)

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

const assertKnownKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void => {
  for (const key of Object.keys(value)) {
    if (!keys.some((knownKey) => knownKey === key)) {
      throw new RangeError(`Unknown ${label} key: ${key}`)
    }
  }
}

const nonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') {
    throw new TypeError(`Minecraft ambient sounds ${field} must be a string`)
  }
  if (value.length === ZERO) {
    throw new RangeError(`Minecraft ambient sounds ${field} must not be empty`)
  }
  return value
}

const integerAtLeast = (value: unknown, field: string, minimum: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new RangeError(`Minecraft ambient sounds ${field} must be an integer at least ${minimum}`)
  }
  return value
}

const finiteNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`Minecraft ambient sounds ${field} must be finite`)
  }
  return value
}

const chance = (value: unknown, field: string): number => {
  const resolved = finiteNumber(value, field)
  if (resolved < ZERO || resolved > ONE) {
    throw new RangeError(`Minecraft ambient sounds ${field} must be between 0 and 1`)
  }
  return resolved
}

export type MinecraftAmbientMood = {
  readonly sound: string
  readonly tick_delay: number
  readonly block_search_extent: number
  readonly offset: number
}

export type MinecraftAmbientAddition = {
  readonly sound: string
  readonly tick_chance: number
}

export type MinecraftAmbientSoundsDefinition = {
  readonly loop?: string
  readonly mood?: MinecraftAmbientMood
  readonly additions?: readonly MinecraftAmbientAddition[]
}

export type NormalizedMinecraftAmbientSoundsDefinition = {
  readonly loop: string | null
  readonly mood: MinecraftAmbientMood | null
  readonly additions: readonly MinecraftAmbientAddition[]
}

const normalizeMood = (value: unknown): MinecraftAmbientMood | null => {
  if (isMissing(value) || value === null) {
    return null
  }
  const mood = requireRecord(value, 'Minecraft ambient sounds mood')
  assertKnownKeys(mood, AMBIENT_MOOD_KEYS, 'Minecraft ambient sounds mood')
  return {
    block_search_extent: integerAtLeast(mood['block_search_extent'], 'mood.block_search_extent', ZERO),
    offset: finiteNumber(mood['offset'], 'mood.offset'),
    sound: nonEmptyString(mood['sound'], 'mood.sound'),
    tick_delay: integerAtLeast(mood['tick_delay'], 'mood.tick_delay', MIN_TICK_DELAY),
  }
}

const normalizeAdditions = (value: unknown): readonly MinecraftAmbientAddition[] => {
  if (isMissing(value) || value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new TypeError('Minecraft ambient sounds additions must be an array')
  }
  return value.map((addition, index) => {
    const rawAddition = requireRecord(addition, `Minecraft ambient sounds additions[${index}]`)
    assertKnownKeys(rawAddition, AMBIENT_ADDITION_KEYS, 'Minecraft ambient sounds addition')
    return {
      sound: nonEmptyString(rawAddition['sound'], `additions[${index}].sound`),
      tick_chance: chance(rawAddition['tick_chance'], `additions[${index}].tick_chance`),
    }
  })
}

const normalizeLoop = (value: unknown): string | null => {
  if (isMissing(value) || value === null) {
    return null
  }
  return nonEmptyString(value, 'loop')
}

export const normalizeMinecraftAmbientSoundsDefinition = (
  definition?: MinecraftAmbientSoundsDefinition | null,
): NormalizedMinecraftAmbientSoundsDefinition => {
  if (isMissing(definition) || definition === null) {
    return { additions: [], loop: null, mood: null }
  }
  const rawDefinition = requireRecord(definition, 'Minecraft ambient sounds definition')
  assertKnownKeys(rawDefinition, AMBIENT_SOUND_KEYS, 'Minecraft ambient sounds definition')
  return {
    additions: normalizeAdditions(rawDefinition['additions']),
    loop: normalizeLoop(rawDefinition['loop']),
    mood: normalizeMood(rawDefinition['mood']),
  }
}

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

export type MinecraftAmbientSoundsPlannerInput = {
  readonly definition?: MinecraftAmbientSoundsDefinition | null
  readonly moodPosition: Position | null
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
  readonly mood: MinecraftAmbientMood | null
  readonly moodPosition: Position | null
  readonly nextMoodTick: number
  readonly tick: number
}

type MoodPlan = {
  readonly commands: readonly MinecraftAmbientSoundsCommand[]
  readonly nextMoodTick: number
}

const planMoodCommands = ({
  mood,
  moodPosition,
  nextMoodTick,
  tick,
}: MoodPlanInput): MoodPlan => {
  if (mood === null) {
    return { commands: [], nextMoodTick: ZERO }
  }
  if (tick < nextMoodTick) {
    return { commands: [], nextMoodTick }
  }

  const commands: MinecraftAmbientSoundsCommand[] = []
  if (moodPosition !== null) {
    commands.push({
      category: 'mood',
      kind: 'play',
      offset: mood.offset,
      position: moodPosition,
      sound: mood.sound,
    })
  }
  return { commands, nextMoodTick: tick + mood.tick_delay }
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
  definition,
  moodPosition,
  randomSource,
  state,
  tick,
}: MinecraftAmbientSoundsPlannerInput): MinecraftAmbientSoundsPlan => {
  const normalized = normalizeMinecraftAmbientSoundsDefinition(definition)
  const currentTick = validTick(tick)
  const { loopSound, nextMoodTick } = state
  const loopCommands = planLoopCommands(loopSound, normalized.loop)
  const moodPlan = planMoodCommands({
    mood: normalized.mood,
    moodPosition,
    nextMoodTick,
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

import {
  type AudioCount,
  type AudioDelayTicks,
  type AudioDiagnosticMessage,
  type AudioDiagnosticPath,
  type AudioOffset,
  type AudioVolume,
  type MinecraftSoundEventId,
  AudioCount as makeAudioCount,
  AudioDelayTicks as makeAudioDelayTicks,
  AudioDiagnosticMessage as makeAudioDiagnosticMessage,
  AudioDiagnosticPath as makeAudioDiagnosticPath,
  AudioOffset as makeAudioOffset,
  AudioVolume as makeAudioVolume,
  MinecraftSoundEventId as makeMinecraftSoundEventId,
} from './audio-brands.js'
import { Result } from 'effect'

const ZERO = 0
const ONE = 1
const MIN_TICK_DELAY = 1
const AMBIENT_SOUND_KEYS = ['additions', 'loop', 'mood'] as const
const AMBIENT_MOOD_KEYS = ['block_search_extent', 'offset', 'sound', 'tick_delay'] as const
const AMBIENT_ADDITION_KEYS = ['sound', 'tick_chance'] as const

type JsonObject = Record<string, unknown>

export type MinecraftAmbientSoundsFailure = {
  readonly _tag: 'MinecraftAmbientSoundsFailure'
  readonly path: AudioDiagnosticPath
  readonly message: AudioDiagnosticMessage
}

const failure = (path: string, message: string): Result.Result<never, MinecraftAmbientSoundsFailure> =>
  Result.fail({
    _tag: 'MinecraftAmbientSoundsFailure',
    message: makeAudioDiagnosticMessage(message),
    path: makeAudioDiagnosticPath(path),
  })

const isMissing = (value: unknown): value is undefined => Object.is(value, globalThis.undefined)

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const record = (value: unknown, path: string, label: string): Result.Result<JsonObject, MinecraftAmbientSoundsFailure> => {
  if (isRecord(value)) {
    return Result.succeed(value)
  }
  return failure(path, `${label} must be an object`)
}

type KnownKeysOptions = {
  readonly value: JsonObject
  readonly keys: readonly string[]
  readonly path: string
  readonly label: string
}

const knownKeys = ({ value, keys, path, label }: KnownKeysOptions): Result.Result<void, MinecraftAmbientSoundsFailure> => {
  for (const key of Object.keys(value)) {
    if (!keys.some((knownKey) => knownKey === key)) {
      return failure(`${path}.${key}`, `Unknown ${label} key: ${key}`)
    }
  }
  return Result.succeed(globalThis.undefined)
}

const nonEmptyString = (value: unknown, path: string, field: string): Result.Result<MinecraftSoundEventId, MinecraftAmbientSoundsFailure> => {
  if (typeof value !== 'string' || value.length === ZERO) {
    return failure(path, `Minecraft ambient sounds ${field} must be a non-empty string`)
  }
  return Result.succeed(makeMinecraftSoundEventId(value))
}

type IntegerAtLeastOptions = {
  readonly value: unknown
  readonly path: string
  readonly field: string
  readonly minimum: number
}

const integerAtLeast = ({ value, path, field, minimum }: IntegerAtLeastOptions): Result.Result<number, MinecraftAmbientSoundsFailure> => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= minimum) {
    return Result.succeed(value)
  }
  return failure(path, `Minecraft ambient sounds ${field} must be an integer at least ${minimum}`)
}

const finiteNumber = (value: unknown, path: string, field: string): Result.Result<number, MinecraftAmbientSoundsFailure> => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Result.succeed(value)
  }
  return failure(path, `Minecraft ambient sounds ${field} must be finite`)
}

const chance = (value: unknown, path: string, field: string): Result.Result<AudioVolume, MinecraftAmbientSoundsFailure> => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < ZERO || value > ONE) {
    return failure(path, `Minecraft ambient sounds ${field} must be between 0 and 1`)
  }
  return Result.succeed(makeAudioVolume(value))
}

export type MinecraftAmbientMood = {
  readonly sound: MinecraftSoundEventId
  readonly tick_delay: AudioDelayTicks
  readonly block_search_extent: AudioCount
  readonly offset: AudioOffset
}

export type MinecraftAmbientAddition = {
  readonly sound: MinecraftSoundEventId
  readonly tick_chance: AudioVolume
}

export type MinecraftAmbientSoundsDefinition = {
  readonly loop?: unknown
  readonly mood?: unknown
  readonly additions?: unknown
}

export type NormalizedMinecraftAmbientSoundsDefinition = {
  readonly loop: MinecraftSoundEventId | null
  readonly mood: MinecraftAmbientMood | null
  readonly additions: readonly MinecraftAmbientAddition[]
}

const normalizeMood = (value: unknown): Result.Result<MinecraftAmbientMood | null, MinecraftAmbientSoundsFailure> => {
  if (isMissing(value) || value === null) {
    return Result.succeed(null)
  }
  return Result.gen(function* normalizeMoodEffect() {
    const mood = yield* record(value, 'mood', 'Minecraft ambient sounds mood')
    yield* knownKeys({ keys: AMBIENT_MOOD_KEYS, label: 'Minecraft ambient sounds mood', path: 'mood', value: mood })
    const blockSearchExtent = yield* integerAtLeast({ field: 'mood.block_search_extent', minimum: ZERO, path: 'mood.block_search_extent', value: mood['block_search_extent'] })
    const offset = yield* finiteNumber(mood['offset'], 'mood.offset', 'mood.offset')
    const sound = yield* nonEmptyString(mood['sound'], 'mood.sound', 'mood.sound')
    const tickDelay = yield* integerAtLeast({ field: 'mood.tick_delay', minimum: MIN_TICK_DELAY, path: 'mood.tick_delay', value: mood['tick_delay'] })
    return {
      block_search_extent: makeAudioCount(blockSearchExtent),
      offset: makeAudioOffset(offset),
      sound,
      tick_delay: makeAudioDelayTicks(tickDelay),
    }
  })
}

const normalizeAdditions = (value: unknown): Result.Result<readonly MinecraftAmbientAddition[], MinecraftAmbientSoundsFailure> => {
  if (isMissing(value) || value === null) {
    return Result.succeed([])
  }
  if (!Array.isArray(value)) {
    return failure('additions', 'Minecraft ambient sounds additions must be an array')
  }
  return Result.gen(function* normalizeAdditionsEffect() {
    const additions: MinecraftAmbientAddition[] = []
    for (const [index, addition] of value.entries()) {
      const path = `additions[${index}]`
      const rawAddition = yield* record(addition, path, `Minecraft ambient sounds additions[${index}]`)
      yield* knownKeys({ keys: AMBIENT_ADDITION_KEYS, label: 'Minecraft ambient sounds addition', path, value: rawAddition })
      additions.push({
        sound: yield* nonEmptyString(rawAddition['sound'], `${path}.sound`, `${path}.sound`),
        tick_chance: yield* chance(rawAddition['tick_chance'], `${path}.tick_chance`, `${path}.tick_chance`),
      })
    }
    return additions
  })
}

const normalizeLoop = (value: unknown): Result.Result<MinecraftSoundEventId | null, MinecraftAmbientSoundsFailure> => {
  if (isMissing(value) || value === null) {
    return Result.succeed(null)
  }
  return nonEmptyString(value, 'loop', 'loop')
}

export const normalizeMinecraftAmbientSoundsDefinition = (
  definition?: unknown,
): Result.Result<NormalizedMinecraftAmbientSoundsDefinition, MinecraftAmbientSoundsFailure> => {
  if (isMissing(definition) || definition === null) {
    return Result.succeed({ additions: [], loop: null, mood: null })
  }
  return Result.gen(function* normalizeMinecraftAmbientSoundsDefinitionEffect() {
    const rawDefinition = yield* record(definition, '$', 'Minecraft ambient sounds definition')
    yield* knownKeys({ keys: AMBIENT_SOUND_KEYS, label: 'Minecraft ambient sounds definition', path: '$', value: rawDefinition })
    return {
      additions: yield* normalizeAdditions(rawDefinition['additions']),
      loop: yield* normalizeLoop(rawDefinition['loop']),
      mood: yield* normalizeMood(rawDefinition['mood']),
    }
  })
}

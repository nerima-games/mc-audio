import {
  type AudioDelayTicks,
  type AudioDiagnosticMessage,
  type AudioDiagnosticPath,
  type AudioWeight,
  type MinecraftSoundEventId,
  AudioDelayTicks as makeAudioDelayTicks,
  AudioDiagnosticMessage as makeAudioDiagnosticMessage,
  AudioDiagnosticPath as makeAudioDiagnosticPath,
  AudioWeight as makeAudioWeight,
  MinecraftSoundEventId as makeMinecraftSoundEventId,
} from './audio-brands.js'
import { Result } from 'effect'

export const MINECRAFT_MUSIC_STARTING_DELAY_TICKS = 100
const DEFAULT_MIN_DELAY_TICKS = 12_000
const DEFAULT_MAX_DELAY_TICKS = 24_000
export const MINECRAFT_MUSIC_DEFAULT_MIN_DELAY_TICKS: AudioDelayTicks = makeAudioDelayTicks(DEFAULT_MIN_DELAY_TICKS)
export const MINECRAFT_MUSIC_DEFAULT_MAX_DELAY_TICKS: AudioDelayTicks = makeAudioDelayTicks(DEFAULT_MAX_DELAY_TICKS)
export const MINECRAFT_MUSIC_GAIN_STEP = 0.05

const ZERO_TICKS = 0
const ONE_TICK = 1
const RANDOM_UNIT_UPPER_BOUND = ONE_TICK - Number.EPSILON
const MINECRAFT_MUSIC_DEFINITION_KEYS = ['max_delay', 'min_delay', 'replace_current_music', 'sound'] as const
const MINECRAFT_BIOME_MUSIC_DEFINITION_KEYS = ['data', 'weight'] as const

type JsonObject = Record<string, unknown>

export type MinecraftMusicDataFailure = {
  readonly _tag: 'MinecraftMusicDataFailure'
  readonly path: AudioDiagnosticPath
  readonly message: AudioDiagnosticMessage
}

const failure = (path: string, message: string): Result.Result<never, MinecraftMusicDataFailure> =>
  Result.fail({
    _tag: 'MinecraftMusicDataFailure',
    message: makeAudioDiagnosticMessage(message),
    path: makeAudioDiagnosticPath(path),
  })

/** The normalized background-music object used by Minecraft's data-driven audio format. */
export type MinecraftMusicDefinition = {
  readonly sound: MinecraftSoundEventId
  readonly min_delay: AudioDelayTicks
  readonly max_delay: AudioDelayTicks
  readonly replace_current_music?: boolean
}

export type MinecraftBackgroundMusicKey = 'default' | 'underwater' | 'creative'

export type MinecraftBackgroundMusicInputEntry = unknown

export type MinecraftBackgroundMusicInput = Readonly<
  Partial<Record<MinecraftBackgroundMusicKey, MinecraftBackgroundMusicInputEntry>>
>

export type MinecraftBackgroundMusicEntry = MinecraftMusicDefinition | null

/** The optional normalized `background_music` component from Minecraft's audio settings. */
export type MinecraftBackgroundMusic = Readonly<
  Partial<Record<MinecraftBackgroundMusicKey, MinecraftBackgroundMusicEntry>>
>

/** A raw weighted entry from the biome effects `music` list. */
export type MinecraftBiomeMusicDefinition = unknown

export type MinecraftBiomeMusic = readonly unknown[]

export type NormalizedMinecraftBiomeMusicDefinition = NormalizedMinecraftMusicDefinition & {
  readonly weight: AudioWeight
}

export type NormalizedMinecraftMusicDefinition = Omit<MinecraftMusicDefinition, 'replace_current_music'> & {
  readonly replace_current_music: boolean
}

export const MINECRAFT_BACKGROUND_MUSIC: Readonly<Record<MinecraftBackgroundMusicKey, MinecraftMusicDefinition>> = {
  creative: {
    max_delay: MINECRAFT_MUSIC_DEFAULT_MAX_DELAY_TICKS,
    min_delay: MINECRAFT_MUSIC_DEFAULT_MIN_DELAY_TICKS,
    sound: makeMinecraftSoundEventId('minecraft:music.creative'),
  },
  default: {
    max_delay: MINECRAFT_MUSIC_DEFAULT_MAX_DELAY_TICKS,
    min_delay: MINECRAFT_MUSIC_DEFAULT_MIN_DELAY_TICKS,
    sound: makeMinecraftSoundEventId('minecraft:music.game'),
  },
  underwater: {
    max_delay: MINECRAFT_MUSIC_DEFAULT_MAX_DELAY_TICKS,
    min_delay: MINECRAFT_MUSIC_DEFAULT_MIN_DELAY_TICKS,
    sound: makeMinecraftSoundEventId('minecraft:music.under_water'),
  },
}

export type MinecraftMusicContext = {
  readonly creative: boolean
  readonly underwater: boolean
}

const minecraftBackgroundMusicKeyFor = (context: MinecraftMusicContext): MinecraftBackgroundMusicKey => {
  if (context.underwater) {
    return 'underwater'
  }
  if (context.creative) {
    return 'creative'
  }
  return 'default'
}

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const record = (value: unknown, path: string, label: string): Result.Result<JsonObject, MinecraftMusicDataFailure> => {
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

const knownKeys = ({ value, keys, path, label }: KnownKeysOptions): Result.Result<void, MinecraftMusicDataFailure> => {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      return failure(path, `Unknown ${label} key: ${key}`)
    }
  }
  return Result.succeed(globalThis.undefined)
}

const nonEmptySound = (value: unknown, path: string): Result.Result<MinecraftSoundEventId, MinecraftMusicDataFailure> => {
  if (typeof value !== 'string' || value.length === ZERO_TICKS) {
    return failure(path, 'Minecraft music sound must not be empty')
  }
  return Result.succeed(makeMinecraftSoundEventId(value))
}

const nonNegativeDelay = (value: unknown, path: string, field: string): Result.Result<AudioDelayTicks, MinecraftMusicDataFailure> => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < ZERO_TICKS) {
    return failure(path, `Minecraft music ${field} must be a non-negative integer`)
  }
  return Result.succeed(makeAudioDelayTicks(value))
}

const normalizeReplaceCurrentMusic = (value: unknown, isPresent: boolean, path: string): Result.Result<boolean, MinecraftMusicDataFailure> => {
  if (isPresent && typeof value !== 'boolean') {
    return failure(path, 'Minecraft music replace_current_music must be a boolean')
  }
  if (typeof value === 'boolean') {
    return Result.succeed(value)
  }
  return Result.succeed(false)
}

/** Resolves a data-driven `background_music` object; an omitted context entry means no music. */
export const resolveMinecraftBackgroundMusicDefinition = (
  backgroundMusic: MinecraftBackgroundMusic,
  context: MinecraftMusicContext,
): MinecraftMusicDefinition | null => backgroundMusic[minecraftBackgroundMusicKeyFor(context)] ?? null

/** Underwater takes precedence over the creative-mode background track. */
export const resolveMinecraftMusicDefinition = (
  context: MinecraftMusicContext,
): MinecraftMusicDefinition => MINECRAFT_BACKGROUND_MUSIC[minecraftBackgroundMusicKeyFor(context)]

type RawMinecraftMusicDefinition = {
  readonly maxDelayValue: unknown
  readonly minDelayValue: unknown
  readonly replaceCurrentMusicValue: unknown
  readonly hasReplaceCurrentMusic: boolean
  readonly soundValue: unknown
}

const readMusicDefinition = (rawDefinition: JsonObject): RawMinecraftMusicDefinition => ({
  hasReplaceCurrentMusic: Object.hasOwn(rawDefinition, 'replace_current_music'),
  maxDelayValue: rawDefinition['max_delay'],
  minDelayValue: rawDefinition['min_delay'],
  replaceCurrentMusicValue: rawDefinition['replace_current_music'],
  soundValue: rawDefinition['sound'],
})

export const normalizeMinecraftMusicDefinition = (
  definition: unknown,
): Result.Result<NormalizedMinecraftMusicDefinition, MinecraftMusicDataFailure> => Result.gen(function* normalizeMinecraftMusicDefinitionEffect() {
  const rawDefinition = yield* record(definition, '$', 'Minecraft music definition')
  yield* knownKeys({ keys: MINECRAFT_MUSIC_DEFINITION_KEYS, label: 'Minecraft music definition', path: '$', value: rawDefinition })
  const rawValues = readMusicDefinition(rawDefinition)
  const sound = yield* nonEmptySound(rawValues.soundValue, 'sound')
  const minDelay = yield* nonNegativeDelay(rawValues.minDelayValue, 'min_delay', 'min_delay')
  const maxDelay = yield* nonNegativeDelay(rawValues.maxDelayValue, 'max_delay', 'max_delay')
  if (maxDelay < minDelay) {
    return yield* failure('max_delay', 'Minecraft music max_delay must be no smaller than min_delay')
  }
  const replaceCurrentMusic = yield* normalizeReplaceCurrentMusic(
    rawValues.replaceCurrentMusicValue,
    rawValues.hasReplaceCurrentMusic,
    'replace_current_music',
  )
  return {
    max_delay: maxDelay,
    min_delay: minDelay,
    replace_current_music: replaceCurrentMusic,
    sound,
  }
})

export const normalizeMinecraftBiomeMusicDefinition = (
  definition: unknown,
): Result.Result<NormalizedMinecraftBiomeMusicDefinition, MinecraftMusicDataFailure> => Result.gen(function* normalizeMinecraftBiomeMusicDefinitionEffect() {
  const rawDefinition = yield* record(definition, '$', 'Minecraft biome music definition')
  yield* knownKeys({ keys: MINECRAFT_BIOME_MUSIC_DEFINITION_KEYS, label: 'Minecraft biome music definition', path: '$', value: rawDefinition })
  const { data, weight } = rawDefinition
  const normalized = yield* normalizeMinecraftMusicDefinition(data)
  if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < ONE_TICK) {
    return yield* failure('weight', 'Minecraft biome music weight must be a positive integer')
  }
  return { ...normalized, weight: makeAudioWeight(weight) }
})

export const normalizeMinecraftBiomeMusic = (
  music: readonly unknown[],
): Result.Result<readonly NormalizedMinecraftBiomeMusicDefinition[], MinecraftMusicDataFailure> => Result.gen(function* normalizeMinecraftBiomeMusicEffect() {
  const normalized: NormalizedMinecraftBiomeMusicDefinition[] = []
  for (const definition of music) {
    normalized.push(yield* normalizeMinecraftBiomeMusicDefinition(definition))
  }
  return normalized
})

const randomUnitInterval = (random: unknown): number => {
  if (typeof random !== 'number' || !Number.isFinite(random)) {
    return ZERO_TICKS
  }
  return Math.min(RANDOM_UNIT_UPPER_BOUND, Math.max(ZERO_TICKS, random))
}

const withoutBiomeMusicWeight = (
  definition: NormalizedMinecraftBiomeMusicDefinition,
): NormalizedMinecraftMusicDefinition => {
  const { max_delay, min_delay, replace_current_music, sound } = definition
  return { max_delay, min_delay, replace_current_music, sound }
}

export const selectMinecraftBiomeMusicDefinition = (
  music: MinecraftBiomeMusic,
  random: unknown,
): Result.Result<NormalizedMinecraftMusicDefinition | null, MinecraftMusicDataFailure> => Result.map(
  normalizeMinecraftBiomeMusic(music),
  (normalized) => {
    if (normalized.length === ZERO_TICKS) {
      return null
    }
    const totalWeight = normalized.reduce((total, definition) => total + definition.weight, ZERO_TICKS)
    let target = randomUnitInterval(random) * totalWeight
    for (const definition of normalized) {
      if (target < definition.weight) {
        return withoutBiomeMusicWeight(definition)
      }
      target -= definition.weight
    }
    return withoutBiomeMusicWeight(normalized.reduce((_previousDefinition, definition) => definition))
  },
)

export const MINECRAFT_MUSIC_STARTING_DELAY_TICKS = 100
export const MINECRAFT_MUSIC_DEFAULT_MIN_DELAY_TICKS = 12_000
export const MINECRAFT_MUSIC_DEFAULT_MAX_DELAY_TICKS = 24_000
export const MINECRAFT_MUSIC_GAIN_STEP = 0.05

const ZERO_TICKS = 0
const ONE_TICK = 1
const RANDOM_UNIT_UPPER_BOUND = ONE_TICK - Number.EPSILON
const MINECRAFT_MUSIC_DEFINITION_KEYS = [
  'max_delay',
  'min_delay',
  'replace_current_music',
  'sound',
] as const
const MINECRAFT_BIOME_MUSIC_DEFINITION_KEYS = ['data', 'weight'] as const

/** The background-music object used by Minecraft's data-driven audio format. */
export type MinecraftMusicDefinition = {
  readonly sound: string
  readonly min_delay: number
  readonly max_delay: number
  readonly replace_current_music?: boolean
}

export type MinecraftBackgroundMusicKey = 'default' | 'underwater' | 'creative'

export type MinecraftBackgroundMusicInputEntry =
  | MinecraftMusicDefinition
  | Readonly<Record<string, never>>

export type MinecraftBackgroundMusicInput = Readonly<
  Partial<Record<MinecraftBackgroundMusicKey, MinecraftBackgroundMusicInputEntry>>
>

export type MinecraftBackgroundMusicEntry = MinecraftMusicDefinition | null

/** The optional `background_music` component from Minecraft's audio settings. */
export type MinecraftBackgroundMusic = Readonly<
  Partial<Record<MinecraftBackgroundMusicKey, MinecraftBackgroundMusicEntry>>
>

/** A weighted entry from the biome effects `music` list. */
export type MinecraftBiomeMusicDefinition = {
  readonly data: MinecraftMusicDefinition
  readonly weight: number
}

export type MinecraftBiomeMusic = readonly MinecraftBiomeMusicDefinition[]

export type NormalizedMinecraftBiomeMusicDefinition = NormalizedMinecraftMusicDefinition & {
  readonly weight: number
}

export type NormalizedMinecraftMusicDefinition = Omit<MinecraftMusicDefinition, 'replace_current_music'> & {
  readonly replace_current_music: boolean
}

export const MINECRAFT_BACKGROUND_MUSIC = {
  creative: {
    max_delay: MINECRAFT_MUSIC_DEFAULT_MAX_DELAY_TICKS,
    min_delay: MINECRAFT_MUSIC_DEFAULT_MIN_DELAY_TICKS,
    sound: 'minecraft:music.creative',
  },
  default: {
    max_delay: MINECRAFT_MUSIC_DEFAULT_MAX_DELAY_TICKS,
    min_delay: MINECRAFT_MUSIC_DEFAULT_MIN_DELAY_TICKS,
    sound: 'minecraft:music.game',
  },
  underwater: {
    max_delay: MINECRAFT_MUSIC_DEFAULT_MAX_DELAY_TICKS,
    min_delay: MINECRAFT_MUSIC_DEFAULT_MIN_DELAY_TICKS,
    sound: 'minecraft:music.under_water',
  },
} as const satisfies Readonly<Record<'creative' | 'default' | 'underwater', MinecraftMusicDefinition>>

export type MinecraftMusicContext = {
  readonly creative: boolean
  readonly underwater: boolean
}

const minecraftBackgroundMusicKeyFor = function minecraftBackgroundMusicKeyFor(
  context: MinecraftMusicContext,
): MinecraftBackgroundMusicKey {
  if (context.underwater) {
    return 'underwater'
  }
  if (context.creative) {
    return 'creative'
  }
  return 'default'
}

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

type RawMinecraftMusicDefinition = {
  readonly hasReplaceCurrentMusic: boolean
  readonly maxDelay: unknown
  readonly minDelay: unknown
  readonly replaceCurrentMusic: unknown
  readonly sound: unknown
}

const readMinecraftMusicDefinition = (
  definition: MinecraftMusicDefinition,
): RawMinecraftMusicDefinition => {
  const rawDefinition = requireRecord(definition, 'Minecraft music definition')
  assertKnownKeys(rawDefinition, MINECRAFT_MUSIC_DEFINITION_KEYS, 'Minecraft music definition')
  const {
    max_delay: maxDelay,
    min_delay: minDelay,
    replace_current_music: replaceCurrentMusic,
    sound,
  } = rawDefinition
  return {
    hasReplaceCurrentMusic: Object.hasOwn(rawDefinition, 'replace_current_music'),
    maxDelay,
    minDelay,
    replaceCurrentMusic,
    sound,
  }
}

const requireMinecraftMusicSound = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === ZERO_TICKS) {
    throw new RangeError('Minecraft music sound must not be empty')
  }
  return value
}

const requireNonNegativeMinecraftMusicDelay = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < ZERO_TICKS) {
    throw new RangeError('Minecraft music min_delay must be a non-negative integer')
  }
  return value
}

const requireMinecraftMusicMaxDelay = (value: unknown, minDelay: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minDelay) {
    throw new RangeError('Minecraft music max_delay must be an integer no smaller than min_delay')
  }
  return value
}

const normalizeMinecraftReplaceCurrentMusic = (
  value: unknown,
  isPresent: boolean,
): boolean => {
  if (isPresent && typeof value !== 'boolean') {
    throw new TypeError('Minecraft music replace_current_music must be a boolean')
  }
  if (typeof value === 'boolean') {
    return value
  }
  return false
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

export const normalizeMinecraftMusicDefinition = (
  definition: MinecraftMusicDefinition,
): NormalizedMinecraftMusicDefinition => {
  const rawDefinition = readMinecraftMusicDefinition(definition)
  const sound = requireMinecraftMusicSound(rawDefinition.sound)
  const minDelay = requireNonNegativeMinecraftMusicDelay(rawDefinition.minDelay)
  const maxDelay = requireMinecraftMusicMaxDelay(rawDefinition.maxDelay, minDelay)
  const replaceCurrentMusic = normalizeMinecraftReplaceCurrentMusic(
    rawDefinition.replaceCurrentMusic,
    rawDefinition.hasReplaceCurrentMusic,
  )
  return {
    max_delay: maxDelay,
    min_delay: minDelay,
    replace_current_music: replaceCurrentMusic,
    sound,
  }
}

export const normalizeMinecraftBiomeMusicDefinition = (
  definition: MinecraftBiomeMusicDefinition,
): NormalizedMinecraftBiomeMusicDefinition => {
  const rawDefinition = requireRecord(definition, 'Minecraft biome music definition')
  assertKnownKeys(
    rawDefinition,
    MINECRAFT_BIOME_MUSIC_DEFINITION_KEYS,
    'Minecraft biome music definition',
  )
  const { data, weight } = rawDefinition
  const normalized = normalizeMinecraftMusicDefinition(
    requireRecord(data, 'Minecraft biome music data') as MinecraftMusicDefinition,
  )
  if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < ONE_TICK) {
    throw new RangeError('Minecraft biome music weight must be a positive integer')
  }
  return { ...normalized, weight }
}

export const normalizeMinecraftBiomeMusic = (
  music: MinecraftBiomeMusic,
): readonly NormalizedMinecraftBiomeMusicDefinition[] => music.map(normalizeMinecraftBiomeMusicDefinition)

const randomUnitInterval = (random: number): number => {
  if (!Number.isFinite(random)) {
    return ZERO_TICKS
  }
  return Math.min(RANDOM_UNIT_UPPER_BOUND, Math.max(ZERO_TICKS, random))
}

const withoutBiomeMusicWeight = (
  definition: NormalizedMinecraftBiomeMusicDefinition,
): NormalizedMinecraftMusicDefinition => ({
  max_delay: definition.max_delay,
  min_delay: definition.min_delay,
  replace_current_music: definition.replace_current_music,
  sound: definition.sound,
})

export const selectMinecraftBiomeMusicDefinition = (
  music: MinecraftBiomeMusic,
  random: number,
): NormalizedMinecraftMusicDefinition | null => {
  const normalized = normalizeMinecraftBiomeMusic(music)
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
  return withoutBiomeMusicWeight(normalized[normalized.length - ONE_TICK]!)
}


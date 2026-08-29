import type {
  MinecraftMobSoundBehavior,
  MinecraftMobSoundResolutionOptions,
  MinecraftMobSoundVariantDefinition,
  MinecraftMobSoundVariantRegistry,
  MinecraftWolfSoundBehavior,
  MinecraftWolfSoundDefinition,
} from './minecraft-mob-sound-variant-types.js'
import type { MinecraftSoundRegistry, ResolvedMinecraftSound } from './minecraft-sounds-types.js'
import { resolveMinecraftSound } from './minecraft-sounds-resolver.js'

const DEFAULT_IS_BABY = false
const DEFAULT_RANDOM = 0

const SOUND_FIELD_BY_BEHAVIOR: Readonly<Record<MinecraftMobSoundBehavior, string>> = {
  ambient: 'ambientSound',
  begForFood: 'begForFoodSound',
  death: 'deathSound',
  eat: 'eatSound',
  hiss: 'hissSound',
  hurt: 'hurtSound',
  purr: 'purrSound',
  purreow: 'purreowSound',
  step: 'stepSound',
  strayAmbient: 'strayAmbientSound',
}

const WOLF_SOUND_FIELD_BY_BEHAVIOR: Readonly<Record<MinecraftWolfSoundBehavior, string>> = {
  ambient: 'ambientSound',
  death: 'deathSound',
  growl: 'growlSound',
  hurt: 'hurtSound',
  pant: 'pantSound',
  whine: 'whineSound',
}

const soundSetFor = (
  definition: MinecraftMobSoundVariantDefinition,
  isBaby: boolean,
): Readonly<Record<string, string>> => {
  if (definition.kind === 'cow') {
    return definition.sounds
  }
  if (isBaby) {
    return definition.babySounds
  }
  return definition.adultSounds
}

const wolfSoundSetFor = (
  definition: MinecraftWolfSoundDefinition,
  isBaby: boolean,
): Readonly<Record<string, string>> => {
  if (isBaby) {
    return definition.babySounds
  }
  return definition.adultSounds
}

const eventIdFromSoundSet = (
  soundSet: Readonly<Record<string, string>>,
  field: string,
  behavior: string,
): string => {
  const eventId = soundSet[field]
  if (typeof eventId !== 'string') {
    throw new Error(`Minecraft sound variant does not define ${behavior}`)
  }
  return eventId
}

export const resolveMinecraftMobSoundEventId = (
  definition: MinecraftMobSoundVariantDefinition,
  behavior: MinecraftMobSoundBehavior,
  isBaby = DEFAULT_IS_BABY,
): string => eventIdFromSoundSet(
  soundSetFor(definition, isBaby),
  SOUND_FIELD_BY_BEHAVIOR[behavior],
  behavior,
)

type ResolveMinecraftMobSoundOptions = {
  readonly behavior: MinecraftMobSoundBehavior
  readonly definition: MinecraftMobSoundVariantDefinition
  readonly options?: MinecraftMobSoundResolutionOptions
  readonly registry: MinecraftSoundRegistry
}

export const resolveMinecraftMobSound = ({ behavior, definition, options = {}, registry }: ResolveMinecraftMobSoundOptions): ResolvedMinecraftSound => resolveMinecraftSound(
  registry,
  resolveMinecraftMobSoundEventId(definition, behavior, options.isBaby ?? DEFAULT_IS_BABY),
  options.random ?? DEFAULT_RANDOM,
)

export const resolveMinecraftMobSoundVariant = (
  options: {
    readonly behavior: MinecraftMobSoundBehavior
    readonly options?: MinecraftMobSoundResolutionOptions
    readonly registry: MinecraftSoundRegistry
    readonly variantId: string
    readonly variants: MinecraftMobSoundVariantRegistry
  },
): ResolvedMinecraftSound => {
  const { behavior, options: resolutionOptions = {}, registry, variantId, variants } = options
  const definition = variants.variants[variantId]
  if (typeof definition !== 'object' || definition === null) {
    throw new Error(`Unknown Minecraft ${variants.kind} sound variant: ${variantId}`)
  }
  return resolveMinecraftMobSound({ behavior, definition, options: resolutionOptions, registry })
}

export const resolveMinecraftWolfSoundEventId = (
  definition: MinecraftWolfSoundDefinition,
  behavior: MinecraftWolfSoundBehavior,
  isBaby = DEFAULT_IS_BABY,
): string => eventIdFromSoundSet(
  wolfSoundSetFor(definition, isBaby),
  WOLF_SOUND_FIELD_BY_BEHAVIOR[behavior],
  behavior,
)

export const resolveMinecraftWolfSound = (
  options: {
    readonly behavior: MinecraftWolfSoundBehavior
    readonly definition: MinecraftWolfSoundDefinition
    readonly options?: MinecraftMobSoundResolutionOptions
    readonly registry: MinecraftSoundRegistry
  },
): ResolvedMinecraftSound => {
  const { behavior, definition, options: resolutionOptions = {}, registry } = options
  return resolveMinecraftSound(
    registry,
    resolveMinecraftWolfSoundEventId(definition, behavior, resolutionOptions.isBaby ?? DEFAULT_IS_BABY),
    resolutionOptions.random ?? DEFAULT_RANDOM,
  )
}


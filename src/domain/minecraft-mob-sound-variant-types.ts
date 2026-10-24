import type { MinecraftMobSoundVariantId, MinecraftSoundEventId, MinecraftSoundNamespace } from './audio-brands.js'

export const MINECRAFT_MOB_SOUND_VARIANT_KINDS = ['cat', 'pig', 'cow', 'chicken'] as const

export type MinecraftMobSoundVariantKind = (typeof MINECRAFT_MOB_SOUND_VARIANT_KINDS)[number]

export type MinecraftCatSoundSet = {
  readonly ambientSound: MinecraftSoundEventId
  readonly strayAmbientSound: MinecraftSoundEventId
  readonly hissSound: MinecraftSoundEventId
  readonly hurtSound: MinecraftSoundEventId
  readonly deathSound: MinecraftSoundEventId
  readonly eatSound: MinecraftSoundEventId
  readonly begForFoodSound: MinecraftSoundEventId
  readonly purrSound: MinecraftSoundEventId
  readonly purreowSound: MinecraftSoundEventId
}

export type MinecraftPigSoundSet = {
  readonly ambientSound: MinecraftSoundEventId
  readonly hurtSound: MinecraftSoundEventId
  readonly deathSound: MinecraftSoundEventId
  readonly stepSound: MinecraftSoundEventId
  readonly eatSound: MinecraftSoundEventId
}

export type MinecraftCowSoundSet = {
  readonly ambientSound: MinecraftSoundEventId
  readonly hurtSound: MinecraftSoundEventId
  readonly deathSound: MinecraftSoundEventId
  readonly stepSound: MinecraftSoundEventId
}

export type MinecraftChickenSoundSet = {
  readonly ambientSound: MinecraftSoundEventId
  readonly hurtSound: MinecraftSoundEventId
  readonly deathSound: MinecraftSoundEventId
  readonly stepSound: MinecraftSoundEventId
}

export type MinecraftWolfSoundSet = {
  readonly ambientSound: MinecraftSoundEventId
  readonly deathSound: MinecraftSoundEventId
  readonly growlSound: MinecraftSoundEventId
  readonly hurtSound: MinecraftSoundEventId
  readonly pantSound: MinecraftSoundEventId
  readonly whineSound: MinecraftSoundEventId
}

export type MinecraftMobSoundVariantDefinition =
  | {
      readonly id: MinecraftMobSoundVariantId
      readonly kind: 'cat'
      readonly adultSounds: MinecraftCatSoundSet
      readonly babySounds: MinecraftCatSoundSet
    }
  | {
      readonly id: MinecraftMobSoundVariantId
      readonly kind: 'pig'
      readonly adultSounds: MinecraftPigSoundSet
      readonly babySounds: MinecraftPigSoundSet
    }
  | {
      readonly id: MinecraftMobSoundVariantId
      readonly kind: 'cow'
      readonly sounds: MinecraftCowSoundSet
    }
  | {
      readonly id: MinecraftMobSoundVariantId
      readonly kind: 'chicken'
      readonly adultSounds: MinecraftChickenSoundSet
      readonly babySounds: MinecraftChickenSoundSet
    }

export type MinecraftMobSoundVariantRegistry = {
  readonly kind: MinecraftMobSoundVariantKind
  readonly variants: ReadonlyMap<MinecraftMobSoundVariantId, MinecraftMobSoundVariantDefinition>
}

export type MinecraftMobSoundBehavior =
  | 'ambient'
  | 'strayAmbient'
  | 'hiss'
  | 'hurt'
  | 'death'
  | 'eat'
  | 'begForFood'
  | 'purr'
  | 'purreow'
  | 'step'

export type MinecraftWolfSoundBehavior = 'ambient' | 'death' | 'growl' | 'hurt' | 'pant' | 'whine'

export type MinecraftMobSoundVariantRegistryOptions = {
  readonly namespace: MinecraftSoundNamespace
}

export type MinecraftMobSoundVariantJsonOptions = MinecraftMobSoundVariantRegistryOptions & {
  readonly input: unknown
  readonly kind: unknown
  readonly variantId: MinecraftMobSoundVariantId
}

export type MinecraftMobSoundVariantRegistryParseOptions = MinecraftMobSoundVariantRegistryOptions & {
  readonly input: unknown
  readonly kind: unknown
}

export type MinecraftWolfSoundParserOptions = MinecraftMobSoundVariantRegistryOptions & {
  readonly input: unknown
}

export type MinecraftMobSoundResolutionOptions = {
  readonly isBaby?: boolean
  readonly random?: number
}

export type MinecraftWolfSoundDefinition = {
  readonly adultSounds: MinecraftWolfSoundSet
  readonly babySounds: MinecraftWolfSoundSet
}

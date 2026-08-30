export const MINECRAFT_MOB_SOUND_VARIANT_KINDS = ['cat', 'pig', 'cow', 'chicken'] as const

export type MinecraftMobSoundVariantKind = (typeof MINECRAFT_MOB_SOUND_VARIANT_KINDS)[number]

export type MinecraftCatSoundSet = {
  readonly ambientSound: string
  readonly strayAmbientSound: string
  readonly hissSound: string
  readonly hurtSound: string
  readonly deathSound: string
  readonly eatSound: string
  readonly begForFoodSound: string
  readonly purrSound: string
  readonly purreowSound: string
}

export type MinecraftPigSoundSet = {
  readonly ambientSound: string
  readonly hurtSound: string
  readonly deathSound: string
  readonly stepSound: string
  readonly eatSound: string
}

export type MinecraftCowSoundSet = {
  readonly ambientSound: string
  readonly hurtSound: string
  readonly deathSound: string
  readonly stepSound: string
}

export type MinecraftChickenSoundSet = {
  readonly ambientSound: string
  readonly hurtSound: string
  readonly deathSound: string
  readonly stepSound: string
}

export type MinecraftWolfSoundSet = {
  readonly ambientSound: string
  readonly deathSound: string
  readonly growlSound: string
  readonly hurtSound: string
  readonly pantSound: string
  readonly whineSound: string
}

export type MinecraftMobSoundVariantDefinition =
  | {
      readonly id: string
      readonly kind: 'cat'
      readonly adultSounds: MinecraftCatSoundSet
      readonly babySounds: MinecraftCatSoundSet
    }
  | {
      readonly id: string
      readonly kind: 'pig'
      readonly adultSounds: MinecraftPigSoundSet
      readonly babySounds: MinecraftPigSoundSet
    }
  | {
      readonly id: string
      readonly kind: 'cow'
      readonly sounds: MinecraftCowSoundSet
    }
  | {
      readonly id: string
      readonly kind: 'chicken'
      readonly adultSounds: MinecraftChickenSoundSet
      readonly babySounds: MinecraftChickenSoundSet
    }

export type MinecraftMobSoundVariantRegistry = {
  readonly kind: MinecraftMobSoundVariantKind
  readonly variants: Readonly<Record<string, MinecraftMobSoundVariantDefinition>>
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
  readonly namespace: string
}

export type MinecraftMobSoundVariantJsonOptions = MinecraftMobSoundVariantRegistryOptions & {
  readonly input: unknown
  readonly kind: MinecraftMobSoundVariantKind
  readonly variantId: string
}

export type MinecraftMobSoundVariantRegistryParseOptions = MinecraftMobSoundVariantRegistryOptions & {
  readonly input: unknown
  readonly kind: MinecraftMobSoundVariantKind
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


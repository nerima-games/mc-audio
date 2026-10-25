import {
  type AudioDiagnosticMessage,
  type MinecraftMobSoundVariantId,
  type MinecraftSoundEventId,
  AudioDiagnosticMessage as makeAudioDiagnosticMessage,
} from './audio-brands.js'
import type {
  MinecraftMobSoundBehavior,
  MinecraftMobSoundResolutionOptions,
  MinecraftMobSoundVariantDefinition,
  MinecraftMobSoundVariantRegistry,
  MinecraftWolfSoundBehavior,
  MinecraftWolfSoundDefinition,
} from './minecraft-mob-sound-variant-types.js'
import type { MinecraftSoundRegistry, ResolvedMinecraftSound } from './minecraft-sounds-types.js'
import { type MinecraftSoundResolutionFailure, resolveMinecraftSound } from './minecraft-sounds-resolver.js'
import { Result } from 'effect'

const DEFAULT_IS_BABY = false

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

export type MinecraftMobSoundVariantResolutionFailure = {
  readonly _tag: 'MinecraftMobSoundVariantResolutionFailure'
  readonly behavior: MinecraftMobSoundBehavior | MinecraftWolfSoundBehavior
  readonly message: AudioDiagnosticMessage
  readonly variantId?: MinecraftMobSoundVariantId
}

type ResolveFailure = MinecraftMobSoundVariantResolutionFailure | MinecraftSoundResolutionFailure

const failure = (
  behavior: MinecraftMobSoundBehavior | MinecraftWolfSoundBehavior,
  message: string,
  variantId?: MinecraftMobSoundVariantId,
): Result.Result<never, MinecraftMobSoundVariantResolutionFailure> => {
  const baseFailure: MinecraftMobSoundVariantResolutionFailure = {
    _tag: 'MinecraftMobSoundVariantResolutionFailure',
    behavior,
    message: makeAudioDiagnosticMessage(message),
  }
  if (variantId !== globalThis.undefined) {
    return Result.fail({ ...baseFailure, variantId })
  }
  return Result.fail(baseFailure)
}

const soundSetFor = (
  definition: MinecraftMobSoundVariantDefinition,
  isBaby: boolean,
): Readonly<Record<string, MinecraftSoundEventId>> => {
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
): Readonly<Record<string, MinecraftSoundEventId>> => {
  if (isBaby) {
    return definition.babySounds
  }
  return definition.adultSounds
}

const eventIdFromSoundSet = (
  soundSet: Readonly<Record<string, MinecraftSoundEventId>>,
  field: string,
  behavior: MinecraftMobSoundBehavior | MinecraftWolfSoundBehavior,
): Result.Result<MinecraftSoundEventId, MinecraftMobSoundVariantResolutionFailure> => {
  const eventId = soundSet[field]
  if (eventId === globalThis.undefined) {
    return failure(behavior, `Minecraft sound variant does not define ${behavior}`)
  }
  return Result.succeed(eventId)
}

export const resolveMinecraftMobSoundEventId = (
  definition: MinecraftMobSoundVariantDefinition,
  behavior: MinecraftMobSoundBehavior,
  isBaby: boolean = DEFAULT_IS_BABY,
): Result.Result<MinecraftSoundEventId, MinecraftMobSoundVariantResolutionFailure> => {
  if (typeof isBaby !== 'boolean') {
    return failure(behavior, 'Minecraft mob sound isBaby must be a boolean')
  }
  return eventIdFromSoundSet(soundSetFor(definition, isBaby), SOUND_FIELD_BY_BEHAVIOR[behavior], behavior)
}

type ResolveMinecraftMobSoundOptions = {
  readonly behavior: MinecraftMobSoundBehavior
  readonly definition: MinecraftMobSoundVariantDefinition
  readonly options?: MinecraftMobSoundResolutionOptions
  readonly registry: MinecraftSoundRegistry
}

export const resolveMinecraftMobSound = ({ behavior, definition, options = {}, registry }: ResolveMinecraftMobSoundOptions): Result.Result<ResolvedMinecraftSound, ResolveFailure> =>
  Result.flatMap(
    resolveMinecraftMobSoundEventId(definition, behavior, options.isBaby),
    (eventId) => resolveMinecraftSound(registry, eventId, options.random),
  )

export const resolveMinecraftMobSoundVariant = (options: {
  readonly behavior: MinecraftMobSoundBehavior
  readonly options?: MinecraftMobSoundResolutionOptions
  readonly registry: MinecraftSoundRegistry
  readonly variantId: MinecraftMobSoundVariantId
  readonly variants: MinecraftMobSoundVariantRegistry
}): Result.Result<ResolvedMinecraftSound, ResolveFailure> => {
  const { behavior, options: resolutionOptions = {}, registry, variantId, variants } = options
  const definition = variants.variants.get(variantId)
  if (definition === globalThis.undefined) {
    return failure(behavior, `Unknown Minecraft ${variants.kind} sound variant: ${variantId}`, variantId)
  }
  return resolveMinecraftMobSound({ behavior, definition, options: resolutionOptions, registry })
}

export const resolveMinecraftWolfSoundEventId = (
  definition: MinecraftWolfSoundDefinition,
  behavior: MinecraftWolfSoundBehavior,
  isBaby: boolean = DEFAULT_IS_BABY,
): Result.Result<MinecraftSoundEventId, MinecraftMobSoundVariantResolutionFailure> => {
  if (typeof isBaby !== 'boolean') {
    return failure(behavior, 'Minecraft wolf sound isBaby must be a boolean')
  }
  return eventIdFromSoundSet(wolfSoundSetFor(definition, isBaby), WOLF_SOUND_FIELD_BY_BEHAVIOR[behavior], behavior)
}

export const resolveMinecraftWolfSound = (options: {
  readonly behavior: MinecraftWolfSoundBehavior
  readonly definition: MinecraftWolfSoundDefinition
  readonly options?: MinecraftMobSoundResolutionOptions
  readonly registry: MinecraftSoundRegistry
}): Result.Result<ResolvedMinecraftSound, ResolveFailure> => {
  const { behavior, definition, options: resolutionOptions = {}, registry } = options
  return Result.flatMap(
    resolveMinecraftWolfSoundEventId(definition, behavior, resolutionOptions.isBaby),
    (eventId) => resolveMinecraftSound(registry, eventId, resolutionOptions.random),
  )
}

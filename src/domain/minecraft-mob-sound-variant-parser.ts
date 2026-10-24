import {
  MINECRAFT_MOB_SOUND_VARIANT_KINDS,
  type MinecraftCatSoundSet,
  type MinecraftChickenSoundSet,
  type MinecraftCowSoundSet,
  type MinecraftMobSoundVariantDefinition,
  type MinecraftMobSoundVariantJsonOptions,
  type MinecraftMobSoundVariantKind,
  type MinecraftMobSoundVariantRegistry,
  type MinecraftMobSoundVariantRegistryParseOptions,
  type MinecraftPigSoundSet,
  type MinecraftWolfSoundDefinition,
  type MinecraftWolfSoundParserOptions,
  type MinecraftWolfSoundSet,
} from './minecraft-mob-sound-variant-types.js'
import {
  type MinecraftMobSoundVariantId,
  type MinecraftSoundEventId,
  type MinecraftSoundNamespace,
  MinecraftMobSoundVariantId as makeMinecraftMobSoundVariantId,
  MinecraftSoundEventId as makeMinecraftSoundEventId,
} from './audio-brands.js'
import { Result } from 'effect'
import { normalizeMinecraftSoundId } from './minecraft-sounds-parser.js'

const RESOURCE_NAMESPACE_PATTERN = /^[a-z0-9_.-]+$/u

type JsonObject = Record<string, unknown>
type SoundField = readonly [jsonName: string, propertyName: string]

const CAT_SOUND_FIELDS: readonly SoundField[] = [
  ['ambient_sound', 'ambientSound'], ['stray_ambient_sound', 'strayAmbientSound'], ['hiss_sound', 'hissSound'],
  ['hurt_sound', 'hurtSound'], ['death_sound', 'deathSound'], ['eat_sound', 'eatSound'],
  ['beg_for_food_sound', 'begForFoodSound'], ['purr_sound', 'purrSound'], ['purreow_sound', 'purreowSound'],
]
const PIG_SOUND_FIELDS: readonly SoundField[] = [
  ['ambient_sound', 'ambientSound'], ['hurt_sound', 'hurtSound'], ['death_sound', 'deathSound'],
  ['step_sound', 'stepSound'], ['eat_sound', 'eatSound'],
]
const COW_SOUND_FIELDS: readonly SoundField[] = [
  ['ambient_sound', 'ambientSound'], ['hurt_sound', 'hurtSound'], ['death_sound', 'deathSound'], ['step_sound', 'stepSound'],
]
const CHICKEN_SOUND_FIELDS: readonly SoundField[] = COW_SOUND_FIELDS
const WOLF_SOUND_FIELDS: readonly SoundField[] = [
  ['ambient_sound', 'ambientSound'], ['death_sound', 'deathSound'], ['growl_sound', 'growlSound'],
  ['hurt_sound', 'hurtSound'], ['pant_sound', 'pantSound'], ['whine_sound', 'whineSound'],
]

export type MinecraftMobSoundVariantParseFailure = {
  readonly _tag: 'MinecraftMobSoundVariantParseFailure'
  readonly path: string
  readonly message: string
}

const failure = (path: string, message: string): Result.Result<never, MinecraftMobSoundVariantParseFailure> =>
  Result.fail({ _tag: 'MinecraftMobSoundVariantParseFailure', message, path })

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const jsonObject = (value: unknown, path: string, message: string): Result.Result<JsonObject, MinecraftMobSoundVariantParseFailure> => {
  if (isJsonObject(value)) {
    return Result.succeed(value)
  }
  return failure(path, message)
}

const knownKeys = (value: JsonObject, allowed: readonly string[], path: string): Result.Result<void, MinecraftMobSoundVariantParseFailure> => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return failure(`${path}.${key}`, 'unknown property')
    }
  }
  return Result.succeed(globalThis.undefined)
}

const parseNamespace = (namespace: MinecraftSoundNamespace): Result.Result<MinecraftSoundNamespace, MinecraftMobSoundVariantParseFailure> => {
  if (RESOURCE_NAMESPACE_PATTERN.test(namespace)) {
    return Result.succeed(namespace)
  }
  return failure('namespace', 'expected a lowercase resource namespace')
}

const normalizeVariantId = (
  value: string,
  namespace: MinecraftSoundNamespace,
  path: string,
): Result.Result<MinecraftMobSoundVariantId, MinecraftMobSoundVariantParseFailure> => Result.gen(function* normalizeVariantIdEffect() {
  const soundId = yield* Result.mapError(
    normalizeMinecraftSoundId(value, namespace, path),
    (error) => ({ _tag: 'MinecraftMobSoundVariantParseFailure' as const, message: error.message, path }),
  )
  return makeMinecraftMobSoundVariantId(soundId)
})

type NormalizeSoundSetOptions = {
  readonly fields: readonly SoundField[]
  readonly input: unknown
  readonly namespace: MinecraftSoundNamespace
  readonly path: string
}

const normalizeSoundSet = ({ fields, input, namespace, path }: NormalizeSoundSetOptions): Result.Result<Readonly<Record<string, MinecraftSoundEventId>>, MinecraftMobSoundVariantParseFailure> => Result.gen(function* normalizeSoundSetEffect() {
  const object = yield* jsonObject(input, path, 'expected a sound set object')
  yield* knownKeys(object, fields.map(([jsonName]) => jsonName), path)
  const sounds: Record<string, MinecraftSoundEventId> = {}
  for (const [jsonName, propertyName] of fields) {
    if (Object.hasOwn(object, jsonName)) {
      const rawSound = object[jsonName]
      const normalized = yield* Result.mapError(
        normalizeMinecraftSoundId(rawSound, namespace, `${path}.${jsonName}`),
        (error) => ({ _tag: 'MinecraftMobSoundVariantParseFailure' as const, message: error.message, path: `${path}.${jsonName}` }),
      )
      sounds[propertyName] = makeMinecraftSoundEventId(normalized)
    }
  }
  return sounds
})

const requiredSound = (
  sounds: Readonly<Record<string, MinecraftSoundEventId>>,
  key: string,
  path: string,
): Result.Result<MinecraftSoundEventId, MinecraftMobSoundVariantParseFailure> => {
  const sound = sounds[key]
  if (sound === globalThis.undefined) {
    return failure(path, `Missing normalized sound field: ${key}`)
  }
  return Result.succeed(sound)
}

const toCatSoundSet = (sounds: Readonly<Record<string, MinecraftSoundEventId>>, path: string): Result.Result<MinecraftCatSoundSet, MinecraftMobSoundVariantParseFailure> => Result.gen(function* toCatSoundSetEffect() {
  return {
    ambientSound: yield* requiredSound(sounds, 'ambientSound', path),
    begForFoodSound: yield* requiredSound(sounds, 'begForFoodSound', path),
    deathSound: yield* requiredSound(sounds, 'deathSound', path),
    eatSound: yield* requiredSound(sounds, 'eatSound', path),
    hissSound: yield* requiredSound(sounds, 'hissSound', path),
    hurtSound: yield* requiredSound(sounds, 'hurtSound', path),
    purrSound: yield* requiredSound(sounds, 'purrSound', path),
    purreowSound: yield* requiredSound(sounds, 'purreowSound', path),
    strayAmbientSound: yield* requiredSound(sounds, 'strayAmbientSound', path),
  }
})

const toPigSoundSet = (sounds: Readonly<Record<string, MinecraftSoundEventId>>, path: string): Result.Result<MinecraftPigSoundSet, MinecraftMobSoundVariantParseFailure> => Result.gen(function* toPigSoundSetEffect() {
  return {
    ambientSound: yield* requiredSound(sounds, 'ambientSound', path),
    deathSound: yield* requiredSound(sounds, 'deathSound', path),
    eatSound: yield* requiredSound(sounds, 'eatSound', path),
    hurtSound: yield* requiredSound(sounds, 'hurtSound', path),
    stepSound: yield* requiredSound(sounds, 'stepSound', path),
  }
})

const toCowSoundSet = (sounds: Readonly<Record<string, MinecraftSoundEventId>>, path: string): Result.Result<MinecraftCowSoundSet, MinecraftMobSoundVariantParseFailure> => Result.gen(function* toCowSoundSetEffect() {
  return {
    ambientSound: yield* requiredSound(sounds, 'ambientSound', path),
    deathSound: yield* requiredSound(sounds, 'deathSound', path),
    hurtSound: yield* requiredSound(sounds, 'hurtSound', path),
    stepSound: yield* requiredSound(sounds, 'stepSound', path),
  }
})

const toChickenSoundSet = (sounds: Readonly<Record<string, MinecraftSoundEventId>>, path: string): Result.Result<MinecraftChickenSoundSet, MinecraftMobSoundVariantParseFailure> =>
  Result.map(toCowSoundSet(sounds, path), (set): MinecraftChickenSoundSet => set)

const toWolfSoundSet = (sounds: Readonly<Record<string, MinecraftSoundEventId>>, path: string): Result.Result<MinecraftWolfSoundSet, MinecraftMobSoundVariantParseFailure> => Result.gen(function* toWolfSoundSetEffect() {
  return {
    ambientSound: yield* requiredSound(sounds, 'ambientSound', path),
    deathSound: yield* requiredSound(sounds, 'deathSound', path),
    growlSound: yield* requiredSound(sounds, 'growlSound', path),
    hurtSound: yield* requiredSound(sounds, 'hurtSound', path),
    pantSound: yield* requiredSound(sounds, 'pantSound', path),
    whineSound: yield* requiredSound(sounds, 'whineSound', path),
  }
})

const parseCatSoundSet = (input: unknown, namespace: MinecraftSoundNamespace, path: string): Result.Result<MinecraftCatSoundSet, MinecraftMobSoundVariantParseFailure> =>
  Result.flatMap(normalizeSoundSet({ fields: CAT_SOUND_FIELDS, input, namespace, path }), (sounds) => toCatSoundSet(sounds, path))
const parsePigSoundSet = (input: unknown, namespace: MinecraftSoundNamespace, path: string): Result.Result<MinecraftPigSoundSet, MinecraftMobSoundVariantParseFailure> =>
  Result.flatMap(normalizeSoundSet({ fields: PIG_SOUND_FIELDS, input, namespace, path }), (sounds) => toPigSoundSet(sounds, path))
const parseCowSoundSet = (input: unknown, namespace: MinecraftSoundNamespace, path: string): Result.Result<MinecraftCowSoundSet, MinecraftMobSoundVariantParseFailure> =>
  Result.flatMap(normalizeSoundSet({ fields: COW_SOUND_FIELDS, input, namespace, path }), (sounds) => toCowSoundSet(sounds, path))
const parseChickenSoundSet = (input: unknown, namespace: MinecraftSoundNamespace, path: string): Result.Result<MinecraftChickenSoundSet, MinecraftMobSoundVariantParseFailure> =>
  Result.flatMap(normalizeSoundSet({ fields: CHICKEN_SOUND_FIELDS, input, namespace, path }), (sounds) => toChickenSoundSet(sounds, path))
const parseWolfSoundSet = (input: unknown, namespace: MinecraftSoundNamespace, path: string): Result.Result<MinecraftWolfSoundSet, MinecraftMobSoundVariantParseFailure> =>
  Result.flatMap(normalizeSoundSet({ fields: WOLF_SOUND_FIELDS, input, namespace, path }), (sounds) => toWolfSoundSet(sounds, path))

const isMobSoundVariantKind = (kind: unknown): kind is MinecraftMobSoundVariantKind =>
  MINECRAFT_MOB_SOUND_VARIANT_KINDS.some((candidate) => candidate === kind)

const parseKind = (kind: unknown): Result.Result<MinecraftMobSoundVariantKind, MinecraftMobSoundVariantParseFailure> => {
  if (isMobSoundVariantKind(kind)) {
    return Result.succeed(kind)
  }
  return failure('kind', 'unsupported mob sound variant registry')
}

const parseVariant = (options: {
  readonly id: MinecraftMobSoundVariantId
  readonly input: unknown
  readonly kind: MinecraftMobSoundVariantKind
  readonly namespace: MinecraftSoundNamespace
  readonly path: string
}): Result.Result<MinecraftMobSoundVariantDefinition, MinecraftMobSoundVariantParseFailure> => Result.gen(function* parseVariantEffect() {
  const { id, input, kind, namespace, path } = options
  const object = yield* jsonObject(input, path, 'expected a sound variant object')
  if (kind === 'cow') {
    return { id, kind, sounds: yield* parseCowSoundSet(object, namespace, path) }
  }
  yield* knownKeys(object, ['adult_sounds', 'baby_sounds'], path)
  if (kind === 'cat') {
    return {
      adultSounds: yield* parseCatSoundSet(object['adult_sounds'], namespace, `${path}.adult_sounds`),
      babySounds: yield* parseCatSoundSet(object['baby_sounds'], namespace, `${path}.baby_sounds`),
      id,
      kind,
    }
  }
  if (kind === 'pig') {
    return {
      adultSounds: yield* parsePigSoundSet(object['adult_sounds'], namespace, `${path}.adult_sounds`),
      babySounds: yield* parsePigSoundSet(object['baby_sounds'], namespace, `${path}.baby_sounds`),
      id,
      kind,
    }
  }
  return {
    adultSounds: yield* parseChickenSoundSet(object['adult_sounds'], namespace, `${path}.adult_sounds`),
    babySounds: yield* parseChickenSoundSet(object['baby_sounds'], namespace, `${path}.baby_sounds`),
    id,
    kind,
  }
})

const parseRegistryEntries = (options: {
  readonly input: JsonObject
  readonly kind: MinecraftMobSoundVariantKind
  readonly namespace: MinecraftSoundNamespace
}): Result.Result<ReadonlyMap<MinecraftMobSoundVariantId, MinecraftMobSoundVariantDefinition>, MinecraftMobSoundVariantParseFailure> => Result.gen(function* parseRegistryEntriesEffect() {
  const variants = new Map<MinecraftMobSoundVariantId, MinecraftMobSoundVariantDefinition>()
  for (const [rawId, value] of Object.entries(options.input)) {
    const id = yield* normalizeVariantId(rawId, options.namespace, rawId)
    if (variants.has(id)) {
      return yield* failure(rawId, `duplicate normalized variant id ${id}`)
    }
    variants.set(id, yield* parseVariant({ id, input: value, kind: options.kind, namespace: options.namespace, path: rawId }))
  }
  return variants
})

export const parseMinecraftMobSoundVariantJson = (
  options: MinecraftMobSoundVariantJsonOptions,
): Result.Result<MinecraftMobSoundVariantDefinition, MinecraftMobSoundVariantParseFailure> => Result.gen(function* parseMinecraftMobSoundVariantJsonEffect() {
  const { input, kind, namespace, variantId } = options
  const parsedKind = yield* parseKind(kind)
  const parsedNamespace = yield* parseNamespace(namespace)
  const id = yield* normalizeVariantId(variantId, parsedNamespace, 'variantId')
  return yield* parseVariant({ id, input, kind: parsedKind, namespace: parsedNamespace, path: '$' })
})

export const parseMinecraftMobSoundVariantRegistry = (
  options: MinecraftMobSoundVariantRegistryParseOptions,
): Result.Result<MinecraftMobSoundVariantRegistry, MinecraftMobSoundVariantParseFailure> => Result.gen(function* parseMinecraftMobSoundVariantRegistryEffect() {
  const { input, kind, namespace } = options
  const parsedKind = yield* parseKind(kind)
  const parsedNamespace = yield* parseNamespace(namespace)
  const object = yield* jsonObject(input, '$', 'expected an object keyed by sound variant id')
  const variants = yield* parseRegistryEntries({ input: object, kind: parsedKind, namespace: parsedNamespace })
  return { kind: parsedKind, variants }
})

export const parseMinecraftWolfSoundDefinition = (
  options: MinecraftWolfSoundParserOptions,
): Result.Result<MinecraftWolfSoundDefinition, MinecraftMobSoundVariantParseFailure> => Result.gen(function* parseMinecraftWolfSoundDefinitionEffect() {
  const { input, namespace } = options
  const parsedNamespace = yield* parseNamespace(namespace)
  const object = yield* jsonObject(input, '$', 'expected a wolf sound definition object')
  yield* knownKeys(object, ['adult_sounds', 'baby_sounds'], '$')
  return {
    adultSounds: yield* parseWolfSoundSet(object['adult_sounds'], parsedNamespace, '$.adult_sounds'),
    babySounds: yield* parseWolfSoundSet(object['baby_sounds'], parsedNamespace, '$.baby_sounds'),
  }
})

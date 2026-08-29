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
import { normalizeMinecraftSoundId } from './minecraft-sounds-parser.js'

const RESOURCE_NAMESPACE_PATTERN = /^[a-z0-9_.-]+$/u

type JsonObject = Record<string, unknown>
type SoundField = readonly [jsonName: string, propertyName: string]

const CAT_SOUND_FIELDS: readonly SoundField[] = [
  ['ambient_sound', 'ambientSound'],
  ['stray_ambient_sound', 'strayAmbientSound'],
  ['hiss_sound', 'hissSound'],
  ['hurt_sound', 'hurtSound'],
  ['death_sound', 'deathSound'],
  ['eat_sound', 'eatSound'],
  ['beg_for_food_sound', 'begForFoodSound'],
  ['purr_sound', 'purrSound'],
  ['purreow_sound', 'purreowSound'],
]

const PIG_SOUND_FIELDS: readonly SoundField[] = [
  ['ambient_sound', 'ambientSound'],
  ['hurt_sound', 'hurtSound'],
  ['death_sound', 'deathSound'],
  ['step_sound', 'stepSound'],
  ['eat_sound', 'eatSound'],
]

const COW_SOUND_FIELDS: readonly SoundField[] = [
  ['ambient_sound', 'ambientSound'],
  ['hurt_sound', 'hurtSound'],
  ['death_sound', 'deathSound'],
  ['step_sound', 'stepSound'],
]

const CHICKEN_SOUND_FIELDS: readonly SoundField[] = [
  ['ambient_sound', 'ambientSound'],
  ['hurt_sound', 'hurtSound'],
  ['death_sound', 'deathSound'],
  ['step_sound', 'stepSound'],
]

const WOLF_SOUND_FIELDS: readonly SoundField[] = [
  ['ambient_sound', 'ambientSound'],
  ['death_sound', 'deathSound'],
  ['growl_sound', 'growlSound'],
  ['hurt_sound', 'hurtSound'],
  ['pant_sound', 'pantSound'],
  ['whine_sound', 'whineSound'],
]

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const invalidVariant = (path: string, message: string): never => {
  throw new TypeError(`Invalid Minecraft sound variant at ${path}: ${message}`)
}

const assertJsonObject: (
  value: unknown,
  path: string,
  message: string,
) => asserts value is JsonObject = (value, path, message) => {
  if (!isJsonObject(value)) {
    invalidVariant(path, message)
  }
}

const assertKnownKeys = (value: JsonObject, allowed: readonly string[], path: string): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalidVariant(`${path}.${key}`, 'unknown property')
    }
  }
}

const parseNamespace = (namespace: string): string => {
  if (!RESOURCE_NAMESPACE_PATTERN.test(namespace)) {
    invalidVariant('namespace', 'expected a lowercase resource namespace')
  }
  return namespace
}

const normalizeVariantId = (value: string, namespace: string, path: string): string =>
  normalizeMinecraftSoundId(value, namespace, path)

type NormalizeSoundSetOptions = {
  readonly fields: readonly SoundField[]
  readonly input: unknown
  readonly namespace: string
  readonly path: string
}

const normalizeSoundSet = ({ fields, input, namespace, path }: NormalizeSoundSetOptions): Readonly<Record<string, string>> => {
  assertJsonObject(input, path, 'expected a sound set object')
  assertKnownKeys(input, fields.map(([jsonName]) => jsonName), path)

  const sounds: Record<string, string> = {}
  for (const [jsonName, propertyName] of fields) {
    sounds[propertyName] = normalizeMinecraftSoundId(input[jsonName], namespace, `${path}.${jsonName}`)
  }
  return sounds
}

const parseCatSoundSet = (input: unknown, namespace: string, path: string): MinecraftCatSoundSet =>
  normalizeSoundSet({ fields: CAT_SOUND_FIELDS, input, namespace, path }) as MinecraftCatSoundSet

const parsePigSoundSet = (input: unknown, namespace: string, path: string): MinecraftPigSoundSet =>
  normalizeSoundSet({ fields: PIG_SOUND_FIELDS, input, namespace, path }) as MinecraftPigSoundSet

const parseCowSoundSet = (input: unknown, namespace: string, path: string): MinecraftCowSoundSet =>
  normalizeSoundSet({ fields: COW_SOUND_FIELDS, input, namespace, path }) as MinecraftCowSoundSet

const parseChickenSoundSet = (input: unknown, namespace: string, path: string): MinecraftChickenSoundSet =>
  normalizeSoundSet({ fields: CHICKEN_SOUND_FIELDS, input, namespace, path }) as MinecraftChickenSoundSet

const parseWolfSoundSet = (input: unknown, namespace: string, path: string): MinecraftWolfSoundSet =>
  normalizeSoundSet({ fields: WOLF_SOUND_FIELDS, input, namespace, path }) as MinecraftWolfSoundSet

const parseKind = (kind: MinecraftMobSoundVariantKind): MinecraftMobSoundVariantKind => {
  if (!(MINECRAFT_MOB_SOUND_VARIANT_KINDS as readonly string[]).includes(kind)) {
    invalidVariant('kind', 'unsupported mob sound variant registry')
  }
  return kind
}

const parseAgeBasedVariant = (
  options: {
    readonly input: JsonObject
    readonly kind: Exclude<MinecraftMobSoundVariantKind, 'cow'>
    readonly namespace: string
    readonly path: string
  },
): Omit<MinecraftMobSoundVariantDefinition, 'id' | 'kind'> => {
  const { input, kind, namespace, path } = options
  assertKnownKeys(input, ['adult_sounds', 'baby_sounds'], path)
  if (kind === 'cat') {
    return {
      adultSounds: parseCatSoundSet(input['adult_sounds'], namespace, `${path}.adult_sounds`),
      babySounds: parseCatSoundSet(input['baby_sounds'], namespace, `${path}.baby_sounds`),
    }
  }
  if (kind === 'pig') {
    return {
      adultSounds: parsePigSoundSet(input['adult_sounds'], namespace, `${path}.adult_sounds`),
      babySounds: parsePigSoundSet(input['baby_sounds'], namespace, `${path}.baby_sounds`),
    }
  }
  return {
    adultSounds: parseChickenSoundSet(input['adult_sounds'], namespace, `${path}.adult_sounds`),
    babySounds: parseChickenSoundSet(input['baby_sounds'], namespace, `${path}.baby_sounds`),
  }
}

const parseVariant = (
  options: {
    readonly id: string
    readonly input: unknown
    readonly kind: MinecraftMobSoundVariantKind
    readonly namespace: string
    readonly path: string
  },
): MinecraftMobSoundVariantDefinition => {
  const { id, input, kind, namespace, path } = options
  assertJsonObject(input, path, 'expected a sound variant object')
  if (kind === 'cow') {
    return { id, kind, sounds: parseCowSoundSet(input, namespace, path) }
  }
  return {
    id,
    kind,
    ...parseAgeBasedVariant({ input, kind, namespace, path }),
  } as MinecraftMobSoundVariantDefinition
}

type ParseRegistryEntriesOptions = {
  readonly input: JsonObject
  readonly kind: MinecraftMobSoundVariantKind
  readonly namespace: string
}

const parseRegistryEntries = ({ input, kind, namespace }: ParseRegistryEntriesOptions): Record<string, MinecraftMobSoundVariantDefinition> => {
  const variants: Record<string, MinecraftMobSoundVariantDefinition> = {}
  for (const [rawId, value] of Object.entries(input)) {
    const id = normalizeVariantId(rawId, namespace, rawId)
    if (Object.hasOwn(variants, id)) {
      invalidVariant(rawId, `duplicate normalized variant id ${id}`)
    }
    variants[id] = parseVariant({ id, input: value, kind, namespace, path: rawId })
  }
  return variants
}

export const parseMinecraftMobSoundVariantJson = (
  options: MinecraftMobSoundVariantJsonOptions,
): MinecraftMobSoundVariantDefinition => {
  const { input, kind, namespace, variantId } = options
  const parsedKind = parseKind(kind)
  const parsedNamespace = parseNamespace(namespace)
  const id = normalizeVariantId(variantId, parsedNamespace, 'variantId')
  return parseVariant({ id, input, kind: parsedKind, namespace: parsedNamespace, path: '$' })
}

export const parseMinecraftMobSoundVariantRegistry = (
  options: MinecraftMobSoundVariantRegistryParseOptions,
): MinecraftMobSoundVariantRegistry => {
  const { input, kind, namespace } = options
  const parsedKind = parseKind(kind)
  const parsedNamespace = parseNamespace(namespace)
  assertJsonObject(input, '$', 'expected an object keyed by sound variant id')
  return {
    kind: parsedKind,
    variants: parseRegistryEntries({ input, kind: parsedKind, namespace: parsedNamespace }),
  }
}

export const parseMinecraftWolfSoundDefinition = (
  options: MinecraftWolfSoundParserOptions,
): MinecraftWolfSoundDefinition => {
  const { input, namespace } = options
  const parsedNamespace = parseNamespace(namespace)
  assertJsonObject(input, '$', 'expected a wolf sound definition object')
  assertKnownKeys(input, ['adult_sounds', 'baby_sounds'], '$')
  return {
    adultSounds: parseWolfSoundSet(input['adult_sounds'], parsedNamespace, '$.adult_sounds'),
    babySounds: parseWolfSoundSet(input['baby_sounds'], parsedNamespace, '$.baby_sounds'),
  }
}


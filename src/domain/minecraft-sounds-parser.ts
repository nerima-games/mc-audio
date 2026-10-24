import {
  type AudioDistance,
  type AudioGain,
  type AudioPlaybackRate,
  type AudioWeight,
  type MinecraftSoundEventId,
  type MinecraftSoundNamespace,
  type MinecraftSoundResourceId,
  AudioDistance as makeAudioDistance,
  AudioGain as makeAudioGain,
  AudioPlaybackRate as makeAudioPlaybackRate,
  AudioWeight as makeAudioWeight,
  MinecraftSoundEventId as makeMinecraftSoundEventId,
  MinecraftSoundResourceId as makeMinecraftSoundResourceId,
} from './audio-brands.js'
import type {
  MinecraftSoundEvent,
  MinecraftSoundReferenceType,
  MinecraftSoundRegistry,
  MinecraftSoundRegistryOptions,
  MinecraftSoundVariant,
} from './minecraft-sounds-types.js'
import { Result } from 'effect'

const RESOURCE_NAMESPACE_PATTERN = /^[a-z0-9_.-]+$/u
const SOUND_PATH_PATTERN = /^[a-z0-9/._-]+$/u
const DEFAULT_VOLUME = 1
const DEFAULT_PITCH = 1
const DEFAULT_WEIGHT = 1
const DEFAULT_ATTENUATION_DISTANCE = 16
const EMPTY_LENGTH = 0
const MIN_VOLUME = 0
const MIN_PITCH = 0
const MIN_WEIGHT = 0
const MIN_DISTANCE = 0
const INDEX_STEP = 1
const NO_INDEX = -1
const OGG_EXTENSION = '.ogg'
const OGG_EXTENSION_LENGTH = OGG_EXTENSION.length
const CURRENT_SEGMENT = '.'
const PARENT_SEGMENT = '..'

type JsonObject = Record<string, unknown>

export type MinecraftSoundsParseFailure = {
  readonly _tag: 'MinecraftSoundsParseFailure'
  readonly path: string
  readonly message: string
}

type NumberParserOptions = {
  readonly fallback: number
  readonly path: string
  readonly predicate: (value: number) => boolean
  readonly value: unknown
}

type ResourceIdParts = {
  readonly namespace: string
  readonly path: string
}

type ParseSoundEventOptions = {
  readonly defaultNamespace: MinecraftSoundNamespace
  readonly id: MinecraftSoundEventId
  readonly path: string
  readonly value: unknown
}

type ParseSoundVariantOptions = {
  readonly defaultNamespace: MinecraftSoundNamespace
  readonly path: string
  readonly value: unknown
}

const failure = (path: string, message: string): Result.Result<never, MinecraftSoundsParseFailure> =>
  Result.fail({ _tag: 'MinecraftSoundsParseFailure', message, path })

const isMissing = (value: unknown): value is undefined => Object.is(value, globalThis.undefined)

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const jsonObject = (value: unknown, path: string, message: string): Result.Result<JsonObject, MinecraftSoundsParseFailure> => {
  if (isJsonObject(value)) {
    return Result.succeed(value)
  }
  return failure(path, message)
}

const knownKeys = (value: JsonObject, allowed: readonly string[], path: string): Result.Result<void, MinecraftSoundsParseFailure> => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return failure(`${path}.${key}`, 'unknown property')
    }
  }
  return Result.succeed(globalThis.undefined)
}

const parseBoolean = (value: unknown, fallback: boolean, path: string): Result.Result<boolean, MinecraftSoundsParseFailure> => {
  if (isMissing(value)) {
    return Result.succeed(fallback)
  }
  if (typeof value === 'boolean') {
    return Result.succeed(value)
  }
  return failure(path, 'expected a boolean')
}

const parseString = (value: unknown, path: string): Result.Result<string, MinecraftSoundsParseFailure> => {
  if (typeof value === 'string' && value.length > EMPTY_LENGTH) {
    return Result.succeed(value)
  }
  return failure(path, 'expected a non-empty string')
}

const parseNumber = ({ fallback, path, predicate, value }: NumberParserOptions): Result.Result<number, MinecraftSoundsParseFailure> => {
  if (isMissing(value)) {
    return Result.succeed(fallback)
  }
  if (typeof value === 'number' && Number.isFinite(value) && predicate(value)) {
    return Result.succeed(value)
  }
  return failure(path, 'expected a finite number in the supported range')
}

const parseNamespace = (
  namespace: MinecraftSoundNamespace,
  path: string,
): Result.Result<MinecraftSoundNamespace, MinecraftSoundsParseFailure> => {
  if (RESOURCE_NAMESPACE_PATTERN.test(namespace)) {
    return Result.succeed(namespace)
  }
  return failure(path, 'expected a lowercase resource namespace')
}

const resourceIdSeparator = (
  resourceId: string,
  path: string,
): Result.Result<number, MinecraftSoundsParseFailure> => {
  if (resourceId.trim() !== resourceId || resourceId.includes(PARENT_SEGMENT)) {
    return failure(path, 'must not contain whitespace or parent-directory segments')
  }
  const separator = resourceId.indexOf(':')
  if (separator !== NO_INDEX && resourceId.indexOf(':', separator + INDEX_STEP) !== NO_INDEX) {
    return failure(path, 'must contain at most one namespace separator')
  }
  return Result.succeed(separator)
}

const resourceIdParts = (
  resourceId: string,
  defaultNamespace: MinecraftSoundNamespace,
  separator: number,
): ResourceIdParts => {
  if (separator === NO_INDEX) {
    return { namespace: defaultNamespace, path: resourceId }
  }
  return {
    namespace: resourceId.slice(EMPTY_LENGTH, separator),
    path: resourceId.slice(separator + INDEX_STEP),
  }
}

const splitResourceId = (
  value: unknown,
  defaultNamespace: MinecraftSoundNamespace,
  path: string,
): Result.Result<ResourceIdParts, MinecraftSoundsParseFailure> => Result.gen(function* splitResourceIdEffect() {
  const resourceId = yield* parseString(value, path)
  const separator = yield* resourceIdSeparator(resourceId, path)
  const { namespace, path: resourcePath } = resourceIdParts(resourceId, defaultNamespace, separator)
  if (!RESOURCE_NAMESPACE_PATTERN.test(namespace)) {
    return yield* failure(path, 'contains an invalid resource namespace')
  }
  return { namespace, path: resourcePath }
})

const normalizeSoundPath = (rawPath: string, path: string): Result.Result<string, MinecraftSoundsParseFailure> => {
  let soundPath = rawPath
  if (rawPath.endsWith(OGG_EXTENSION)) {
    soundPath = rawPath.slice(EMPTY_LENGTH, -OGG_EXTENSION_LENGTH)
  }
  const hasInvalidSegment = soundPath.split('/').some(
    (segment) => segment.length === EMPTY_LENGTH || segment === CURRENT_SEGMENT,
  )
  if (soundPath.length > EMPTY_LENGTH && SOUND_PATH_PATTERN.test(soundPath) && !hasInvalidSegment) {
    return Result.succeed(soundPath)
  }
  return failure(path, 'contains an invalid sound path')
}

const brandMinecraftSoundResourceId = (
  value: string,
  _path: string,
): Result.Result<MinecraftSoundResourceId, MinecraftSoundsParseFailure> =>
  Result.succeed(makeMinecraftSoundResourceId(value))

export const normalizeMinecraftSoundId = (
  value: unknown,
  defaultNamespace: MinecraftSoundNamespace,
  path: string,
): Result.Result<MinecraftSoundResourceId, MinecraftSoundsParseFailure> => Result.gen(function* normalizeMinecraftSoundIdEffect() {
  const { namespace, path: rawPath } = yield* splitResourceId(value, defaultNamespace, path)
  const soundPath = yield* normalizeSoundPath(rawPath, path)
  return yield* brandMinecraftSoundResourceId(`${namespace}:${soundPath}`, path)
})

const parseReferenceType = (
  value: unknown,
  path: string,
): Result.Result<MinecraftSoundReferenceType, MinecraftSoundsParseFailure> => {
  if (isMissing(value) || value === 'sound') {
    return Result.succeed('sound')
  }
  if (value === 'event') {
    return Result.succeed(value)
  }
  return failure(path, 'expected "sound" or "event"')
}

const defaultSoundVariant = (name: MinecraftSoundResourceId): MinecraftSoundVariant => ({
  attenuationDistance: makeAudioDistance(DEFAULT_ATTENUATION_DISTANCE),
  name,
  pitch: makeAudioPlaybackRate(DEFAULT_PITCH),
  preload: false,
  stream: false,
  type: 'sound',
  volume: makeAudioGain(DEFAULT_VOLUME),
  weight: makeAudioWeight(DEFAULT_WEIGHT),
})

type ParsedSoundVariantValues = {
  readonly attenuationDistance: number
  readonly pitch: number
  readonly preload: boolean
  readonly stream: boolean
  readonly volume: number
  readonly weight: number
}

type BrandedSoundVariantValues = {
  readonly attenuationDistance: AudioDistance
  readonly pitch: AudioPlaybackRate
  readonly preload: boolean
  readonly stream: boolean
  readonly volume: AudioGain
  readonly weight: AudioWeight
}

const parseSoundVariantValues = (
  object: JsonObject,
  path: string,
): Result.Result<ParsedSoundVariantValues, MinecraftSoundsParseFailure> => Result.gen(function* parseSoundVariantValuesEffect() {
  const volume = yield* parseNumber({
    fallback: DEFAULT_VOLUME,
    path: `${path}.volume`,
    predicate: (number) => number >= MIN_VOLUME,
    value: object['volume'],
  })
  const pitch = yield* parseNumber({
    fallback: DEFAULT_PITCH,
    path: `${path}.pitch`,
    predicate: (number) => number > MIN_PITCH,
    value: object['pitch'],
  })
  const weight = yield* parseNumber({
    fallback: DEFAULT_WEIGHT,
    path: `${path}.weight`,
    predicate: (number) => Number.isInteger(number) && number > MIN_WEIGHT,
    value: object['weight'],
  })
  const attenuationDistance = yield* parseNumber({
    fallback: DEFAULT_ATTENUATION_DISTANCE,
    path: `${path}.attenuation_distance`,
    predicate: (number) => number > MIN_DISTANCE,
    value: object['attenuation_distance'],
  })
  const stream = yield* parseBoolean(object['stream'], false, `${path}.stream`)
  const preload = yield* parseBoolean(object['preload'], false, `${path}.preload`)
  return { attenuationDistance, pitch, preload, stream, volume, weight }
})

const brandSoundVariantValues = (
  values: ParsedSoundVariantValues,
  _path: string,
): Result.Result<BrandedSoundVariantValues, MinecraftSoundsParseFailure> => Result.succeed({
  attenuationDistance: makeAudioDistance(values.attenuationDistance),
  pitch: makeAudioPlaybackRate(values.pitch),
  preload: values.preload,
  stream: values.stream,
  volume: makeAudioGain(values.volume),
  weight: makeAudioWeight(values.weight),
})

const parseSoundVariant = ({
  defaultNamespace,
  path,
  value,
}: ParseSoundVariantOptions): Result.Result<MinecraftSoundVariant, MinecraftSoundsParseFailure> => {
  if (typeof value === 'string') {
    return Result.map(normalizeMinecraftSoundId(value, defaultNamespace, path), defaultSoundVariant)
  }
  return Result.gen(function* parseSoundVariantObject() {
    const object = yield* jsonObject(value, path, 'expected a sound name or sound object')
    yield* knownKeys(object, ['name', 'type', 'volume', 'pitch', 'weight', 'stream', 'attenuation_distance', 'preload'], path)
    const name = yield* normalizeMinecraftSoundId(object['name'], defaultNamespace, `${path}.name`)
    const type = yield* parseReferenceType(object['type'], `${path}.type`)
    const values = yield* parseSoundVariantValues(object, path)
    const sharedVariant = yield* brandSoundVariantValues(values, path)
    if (type === 'event') {
      return { ...sharedVariant, name: makeMinecraftSoundEventId(name), type }
    }
    return { ...sharedVariant, name, type }
  })
}

const parseSubtitle = (value: unknown, path: string): Result.Result<string | null, MinecraftSoundsParseFailure> => {
  if (isMissing(value)) {
    return Result.succeed(null)
  }
  if (typeof value === 'string') {
    return Result.succeed(value)
  }
  return failure(path, 'expected a string')
}

const parseSoundVariants = (
  value: unknown,
  defaultNamespace: MinecraftSoundNamespace,
  path: string,
): Result.Result<readonly MinecraftSoundVariant[], MinecraftSoundsParseFailure> => Result.gen(function* parseSoundVariantsEffect() {
  if (!Array.isArray(value)) {
    return yield* failure(path, 'expected an array')
  }
  const sounds: MinecraftSoundVariant[] = []
  for (const [index, sound] of value.entries()) {
    sounds.push(yield* parseSoundVariant({ defaultNamespace, path: `${path}[${index}]`, value: sound }))
  }
  return sounds
})

const parseSoundEvent = ({
  defaultNamespace,
  id,
  path,
  value,
}: ParseSoundEventOptions): Result.Result<MinecraftSoundEvent, MinecraftSoundsParseFailure> => Result.gen(function* parseSoundEventEffect() {
  const object = yield* jsonObject(value, path, 'expected a sound event object')
  yield* knownKeys(object, ['replace', 'subtitle', 'sounds'], path)
  const sounds = yield* parseSoundVariants(object['sounds'], defaultNamespace, `${path}.sounds`)
  const replace = yield* parseBoolean(object['replace'], false, `${path}.replace`)
  const subtitle = yield* parseSubtitle(object['subtitle'], `${path}.subtitle`)
  return { id, replace, sounds, subtitle }
})

type ParseSoundEventEntryOptions = {
  readonly events: Map<MinecraftSoundEventId, MinecraftSoundEvent>
  readonly namespace: MinecraftSoundNamespace
  readonly rawId: string
  readonly value: unknown
}

const parseSoundEventEntry = ({ events, namespace, rawId, value }: ParseSoundEventEntryOptions): Result.Result<void, MinecraftSoundsParseFailure> => Result.gen(function* parseSoundEventEntryEffect() {
  const resourceId = yield* normalizeMinecraftSoundId(rawId, namespace, rawId)
  const id = makeMinecraftSoundEventId(resourceId)
  if (events.has(id)) {
    return yield* failure(rawId, `duplicate normalized sound event id ${id}`)
  }
  events.set(id, yield* parseSoundEvent({ defaultNamespace: namespace, id, path: rawId, value }))
  return globalThis.undefined
})

const parseSoundEvents = (
  object: JsonObject,
  namespace: MinecraftSoundNamespace,
): Result.Result<Map<MinecraftSoundEventId, MinecraftSoundEvent>, MinecraftSoundsParseFailure> => Result.gen(function* parseSoundEventsEffect() {
  const events = new Map<MinecraftSoundEventId, MinecraftSoundEvent>()
  for (const [rawId, value] of Object.entries(object)) {
    yield* parseSoundEventEntry({ events, namespace, rawId, value })
  }
  return events
})

export const parseMinecraftSoundsJson = (
  input: unknown,
  options: MinecraftSoundRegistryOptions,
): Result.Result<MinecraftSoundRegistry, MinecraftSoundsParseFailure> => Result.gen(function* parseMinecraftSoundsJsonEffect() {
  const namespace = yield* parseNamespace(options.namespace, 'namespace')
  const object = yield* jsonObject(input, '$', 'expected an object keyed by sound event id')
  const events = yield* parseSoundEvents(object, namespace)
  return { events }
})

const withoutMergeDirective = (event: MinecraftSoundEvent): MinecraftSoundEvent => ({
  ...event,
  replace: false,
})

const mergeEvents = (baseEvent: MinecraftSoundEvent, overlayEvent: MinecraftSoundEvent): MinecraftSoundEvent => {
  if (overlayEvent.replace) {
    return withoutMergeDirective(overlayEvent)
  }
  return {
    ...overlayEvent,
    replace: false,
    sounds: [...baseEvent.sounds, ...overlayEvent.sounds],
    subtitle: overlayEvent.subtitle ?? baseEvent.subtitle,
  }
}

export const mergeMinecraftSoundRegistries = (
  base: MinecraftSoundRegistry,
  overlay: MinecraftSoundRegistry,
): MinecraftSoundRegistry => {
  const events = new Map<MinecraftSoundEventId, MinecraftSoundEvent>()
  for (const [id, baseEvent] of base.events) {
    const overlayEvent = overlay.events.get(id)
    if (overlayEvent === globalThis.undefined) {
      events.set(id, withoutMergeDirective(baseEvent))
    } else {
      events.set(id, mergeEvents(baseEvent, overlayEvent))
    }
  }
  for (const [id, overlayEvent] of overlay.events) {
    if (!base.events.has(id)) {
      events.set(id, withoutMergeDirective(overlayEvent))
    }
  }
  return { events }
}

import type {
  MinecraftSoundEvent,
  MinecraftSoundReferenceType,
  MinecraftSoundRegistry,
  MinecraftSoundRegistryOptions,
  MinecraftSoundVariant,
} from './minecraft-sounds-types.js'

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
  readonly defaultNamespace: string
  readonly id: string
  readonly path: string
  readonly value: unknown
}

type ParseSoundVariantOptions = {
  readonly defaultNamespace: string
  readonly path: string
  readonly value: unknown
}

const isMissing = (value: unknown): value is undefined => Object.is(value, globalThis.undefined)

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const invalidSoundsJson = (path: string, message: string): never => {
  throw new TypeError(`Invalid sounds.json at ${path}: ${message}`)
}

const assertJsonObject: (
  value: unknown,
  path: string,
  message: string,
) => asserts value is JsonObject = (value, path, message) => {
  if (!isJsonObject(value)) {
    invalidSoundsJson(path, message)
  }
}

const assertKnownKeys = (value: JsonObject, allowed: readonly string[], path: string): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalidSoundsJson(`${path}.${key}`, 'unknown property')
    }
  }
}

const parseBoolean = (value: unknown, fallback: boolean, path: string): boolean => {
  if (isMissing(value)) {
    return fallback
  }
  if (typeof value !== 'boolean') {
    return invalidSoundsJson(path, 'expected a boolean')
  }
  return value
}

const parseString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === EMPTY_LENGTH) {
    return invalidSoundsJson(path, 'expected a non-empty string')
  }
  return value
}

const parseNumber = ({ fallback, path, predicate, value }: NumberParserOptions): number => {
  if (isMissing(value)) {
    return fallback
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !predicate(value)) {
    return invalidSoundsJson(path, 'expected a finite number in the supported range')
  }
  return value
}

const parseNamespace = (namespace: string, path: string): string => {
  if (!RESOURCE_NAMESPACE_PATTERN.test(namespace)) {
    return invalidSoundsJson(path, 'expected a lowercase resource namespace')
  }
  return namespace
}

const resourceIdSeparator = (resourceId: string, path: string): number => {
  if (resourceId.trim() !== resourceId || resourceId.includes(PARENT_SEGMENT)) {
    invalidSoundsJson(path, 'must not contain whitespace or parent-directory segments')
  }

  const separator = resourceId.indexOf(':')
  if (separator !== NO_INDEX && resourceId.indexOf(':', separator + INDEX_STEP) !== NO_INDEX) {
    invalidSoundsJson(path, 'must contain at most one namespace separator')
  }
  return separator
}

const splitResourceId = (value: unknown, defaultNamespace: string, path: string): ResourceIdParts => {
  const resourceId = parseString(value, path)
  const separator = resourceIdSeparator(resourceId, path)

  let namespace = defaultNamespace
  let rawPath = resourceId
  if (separator !== NO_INDEX) {
    namespace = resourceId.slice(EMPTY_LENGTH, separator)
    rawPath = resourceId.slice(separator + INDEX_STEP)
  }
  if (!RESOURCE_NAMESPACE_PATTERN.test(namespace)) {
    invalidSoundsJson(path, 'contains an invalid resource namespace')
  }
  return { namespace, path: rawPath }
}

const normalizeSoundPath = (rawPath: string, path: string): string => {
  let soundPath = rawPath
  if (rawPath.endsWith(OGG_EXTENSION)) {
    soundPath = rawPath.slice(EMPTY_LENGTH, -OGG_EXTENSION_LENGTH)
  }
  const hasInvalidSegment = soundPath.split('/').some(
    (segment) => segment.length === EMPTY_LENGTH || segment === CURRENT_SEGMENT,
  )
  if (soundPath.length === EMPTY_LENGTH || !SOUND_PATH_PATTERN.test(soundPath) || hasInvalidSegment) {
    invalidSoundsJson(path, 'contains an invalid sound path')
  }
  return soundPath
}

export const normalizeMinecraftSoundId = (
  value: unknown,
  defaultNamespace: string,
  path: string,
): string => {
  const { namespace, path: rawPath } = splitResourceId(value, defaultNamespace, path)
  return `${namespace}:${normalizeSoundPath(rawPath, path)}`
}

const parseReferenceType = (value: unknown, path: string): MinecraftSoundReferenceType => {
  if (isMissing(value)) {
    return 'sound'
  }
  if (value !== 'sound' && value !== 'event') {
    return invalidSoundsJson(path, 'expected "sound" or "event"')
  }
  return value
}

const defaultSoundVariant = (name: string): MinecraftSoundVariant => ({
  attenuationDistance: DEFAULT_ATTENUATION_DISTANCE,
  name,
  pitch: DEFAULT_PITCH,
  preload: false,
  stream: false,
  type: 'sound',
  volume: DEFAULT_VOLUME,
  weight: DEFAULT_WEIGHT,
})

const parseSoundVariant = ({ defaultNamespace, path, value }: ParseSoundVariantOptions): MinecraftSoundVariant => {
  if (typeof value === 'string') {
    return defaultSoundVariant(normalizeMinecraftSoundId(value, defaultNamespace, path))
  }
  assertJsonObject(value, path, 'expected a sound name or sound object')

  assertKnownKeys(
    value,
    ['name', 'type', 'volume', 'pitch', 'weight', 'stream', 'attenuation_distance', 'preload'],
    path,
  )
  return {
    attenuationDistance: parseNumber({
      fallback: DEFAULT_ATTENUATION_DISTANCE,
      path: `${path}.attenuation_distance`,
      predicate: (number) => number > MIN_DISTANCE,
      value: value['attenuation_distance'],
    }),
    name: normalizeMinecraftSoundId(value['name'], defaultNamespace, `${path}.name`),
    pitch: parseNumber({
      fallback: DEFAULT_PITCH,
      path: `${path}.pitch`,
      predicate: (number) => number >= MIN_PITCH,
      value: value['pitch'],
    }),
    preload: parseBoolean(value['preload'], false, `${path}.preload`),
    stream: parseBoolean(value['stream'], false, `${path}.stream`),
    type: parseReferenceType(value['type'], `${path}.type`),
    volume: parseNumber({
      fallback: DEFAULT_VOLUME,
      path: `${path}.volume`,
      predicate: (number) => number >= MIN_VOLUME,
      value: value['volume'],
    }),
    weight: parseNumber({
      fallback: DEFAULT_WEIGHT,
      path: `${path}.weight`,
      predicate: (number) => Number.isInteger(number) && number > MIN_WEIGHT,
      value: value['weight'],
    }),
  }
}

const parseSubtitle = (value: unknown, path: string): string | null => {
  if (isMissing(value)) {
    return null
  }
  if (typeof value !== 'string') {
    return invalidSoundsJson(path, 'expected a string')
  }
  return value
}

const parseSoundEvent = ({ defaultNamespace, id, path, value }: ParseSoundEventOptions): MinecraftSoundEvent => {
  assertJsonObject(value, path, 'expected a sound event object')
  assertKnownKeys(value, ['replace', 'subtitle', 'sounds'], path)
  const { sounds } = value
  if (!Array.isArray(sounds)) {
    return invalidSoundsJson(`${path}.sounds`, 'expected an array')
  }

  return {
    id,
    replace: parseBoolean(value['replace'], false, `${path}.replace`),
    sounds: sounds.map((sound, index) => parseSoundVariant({
      defaultNamespace,
      path: `${path}.sounds[${index}]`,
      value: sound,
    })),
    subtitle: parseSubtitle(value['subtitle'], `${path}.subtitle`),
  }
}

export const parseMinecraftSoundsJson = (
  input: unknown,
  options: MinecraftSoundRegistryOptions,
): MinecraftSoundRegistry => {
  const namespace = parseNamespace(options.namespace, 'namespace')
  assertJsonObject(input, '$', 'expected an object keyed by sound event id')

  const events: Record<string, MinecraftSoundEvent> = {}
  for (const [rawId, value] of Object.entries(input)) {
    const id = normalizeMinecraftSoundId(rawId, namespace, rawId)
    if (Object.hasOwn(events, id)) {
      invalidSoundsJson(rawId, `duplicate normalized sound event id ${id}`)
    }
    events[id] = parseSoundEvent({
      defaultNamespace: namespace,
      id,
      path: rawId,
      value,
    })
  }
  return { events }
}

const withoutMergeDirective = (event: MinecraftSoundEvent): MinecraftSoundEvent => ({
  ...event,
  replace: false,
})

const mergeEvents = (
  baseEvent: MinecraftSoundEvent,
  overlayEvent: MinecraftSoundEvent,
): MinecraftSoundEvent => {
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

const mergeBaseEvent = (
  baseEvent: MinecraftSoundEvent,
  overlayEvent: MinecraftSoundEvent | null,
): MinecraftSoundEvent => {
  if (overlayEvent === null) {
    return withoutMergeDirective(baseEvent)
  }
  return mergeEvents(baseEvent, overlayEvent)
}

export const mergeMinecraftSoundRegistries = (
  base: MinecraftSoundRegistry,
  overlay: MinecraftSoundRegistry,
): MinecraftSoundRegistry => {
  const events: Record<string, MinecraftSoundEvent> = Object.fromEntries(
    Object.entries(base.events).map(([id, baseEvent]) => {
      const overlayEvent = overlay.events[id] ?? null
      return [id, mergeBaseEvent(baseEvent, overlayEvent)]
    }),
  )

  for (const [id, overlayEvent] of Object.entries(overlay.events)) {
    if (!Object.hasOwn(base.events, id)) {
      events[id] = withoutMergeDirective(overlayEvent)
    }
  }
  return { events }
}


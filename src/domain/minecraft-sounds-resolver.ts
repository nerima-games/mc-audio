import type { AudioSampleManifest, AudioSampleSource } from './audio-sample.js'
import type {
  MinecraftSoundEvent,
  MinecraftSoundRegistry,
  MinecraftSoundVariant,
  ResolvedMinecraftSound,
} from './minecraft-sounds-types.js'
import { normalizeMinecraftSoundId } from './minecraft-sounds-parser.js'

const DEFAULT_RANDOM = 0
const MIN_RANDOM = 0
const MAX_RANDOM_BOUND = 1
const MAX_RANDOM = MAX_RANDOM_BOUND - Number.EPSILON
const EMPTY_LENGTH = 0
const INDEX_STEP = 1
const DEFAULT_NAMESPACE = 'minecraft'
const RESOURCE_SEPARATOR = ':'

type ResolveEventOptions = {
  readonly eventId: string
  readonly random: number
  readonly registry: MinecraftSoundRegistry
  readonly rootEventId: string
  readonly visited: ReadonlySet<string>
}

type SoundManifestMetadata = {
  readonly preload: boolean
  readonly stream: boolean
}

type CollectSoundSourcesOptions = {
  readonly eventId: string
  readonly registry: MinecraftSoundRegistry
  readonly soundSources: Map<string, SoundManifestMetadata>
  readonly visited: ReadonlySet<string>
  readonly inherited: SoundManifestMetadata
}

const normalizeRandom = (random: number): number => {
  if (!Number.isFinite(random)) {
    return DEFAULT_RANDOM
  }
  return Math.min(MAX_RANDOM, Math.max(MIN_RANDOM, random))
}

export const selectMinecraftSoundVariant = (
  event: MinecraftSoundEvent,
  random: number = DEFAULT_RANDOM,
): MinecraftSoundVariant => {
  if (event.sounds.length === EMPTY_LENGTH) {
    throw new RangeError(`Sound event ${event.id} has no sound variants`)
  }

  const totalWeight = event.sounds.reduce((total, variant) => total + variant.weight, DEFAULT_RANDOM)
  let remaining = normalizeRandom(random) * totalWeight
  for (const variant of event.sounds) {
    if (remaining < variant.weight) {
      return variant
    }
    remaining -= variant.weight
  }

  const lastIndex = event.sounds.length - INDEX_STEP
  return event.sounds[lastIndex]!
}

const eventOrThrow = (registry: MinecraftSoundRegistry, eventId: string): MinecraftSoundEvent => {
  const event = registry.events[eventId] ?? null
  if (event === null) {
    throw new Error(`Unknown Minecraft sound event: ${eventId}`)
  }
  return event
}

const resolveEvent = ({ eventId, random, registry, rootEventId, visited }: ResolveEventOptions): ResolvedMinecraftSound => {
  if (visited.has(eventId)) {
    throw new Error(`Cyclic Minecraft sound event reference: ${[...visited, eventId].join(' -> ')}`)
  }

  const event = eventOrThrow(registry, eventId)
  const nextVisited = new Set(visited).add(eventId)
  const variant = selectMinecraftSoundVariant(event, random)
  if (variant.type === 'sound') {
    return {
      attenuationDistance: variant.attenuationDistance,
      eventId: rootEventId,
      pitch: variant.pitch,
      preload: variant.preload,
      soundId: variant.name,
      stream: variant.stream,
      volume: variant.volume,
    }
  }

  const resolved = resolveEvent({
    eventId: variant.name,
    random,
    registry,
    rootEventId,
    visited: nextVisited,
  })
  return {
    ...resolved,
    attenuationDistance: variant.attenuationDistance,
    pitch: variant.pitch * resolved.pitch,
    preload: variant.preload || resolved.preload,
    stream: variant.stream || resolved.stream,
    volume: variant.volume * resolved.volume,
  }
}

export const resolveMinecraftSound = (
  registry: MinecraftSoundRegistry,
  eventId: string,
  random: number = DEFAULT_RANDOM,
): ResolvedMinecraftSound => resolveEvent({
  eventId,
  random,
  registry,
  rootEventId: eventId,
  visited: new Set<string>(),
})

const collectSoundSources = ({ eventId, registry, soundSources, visited, inherited }: CollectSoundSourcesOptions): void => {
  if (visited.has(eventId)) {
    throw new Error(`Cyclic Minecraft sound event reference: ${[...visited, eventId].join(' -> ')}`)
  }
  const event = eventOrThrow(registry, eventId)
  const nextVisited = new Set(visited).add(eventId)
  for (const variant of event.sounds) {
    const metadata = {
      preload: inherited.preload || variant.preload,
      stream: inherited.stream || variant.stream,
    }
    if (variant.type === 'sound') {
      const previous = soundSources.get(variant.name)
      soundSources.set(variant.name, {
        preload: metadata.preload || previous?.preload === true,
        stream: metadata.stream || previous?.stream === true,
      })
    } else {
      collectSoundSources({
        eventId: variant.name,
        inherited: metadata,
        registry,
        soundSources,
        visited: nextVisited,
      })
    }
  }
}

export const minecraftSoundAssetUrl = (soundId: string, baseUrl: string): string => {
  const normalizedId = normalizeMinecraftSoundId(soundId, DEFAULT_NAMESPACE, 'soundId')
  const separator = normalizedId.indexOf(RESOURCE_SEPARATOR)
  const namespace = normalizedId.slice(DEFAULT_RANDOM, separator)
  const soundPath = normalizedId.slice(separator + INDEX_STEP)
  const prefix = baseUrl.replace(/\/+$/u, '')
  return `${prefix}/assets/${namespace}/sounds/${soundPath}.ogg`
}

export const minecraftSoundManifest = (
  registry: MinecraftSoundRegistry,
  baseUrl: string,
): AudioSampleManifest => {
  const soundSources = new Map<string, SoundManifestMetadata>()
  for (const eventId of Object.keys(registry.events)) {
    collectSoundSources({
      eventId,
      inherited: { preload: false, stream: false },
      registry,
      soundSources,
      visited: new Set<string>(),
    })
  }

  const manifest: Record<string, AudioSampleSource> = {}
  for (const soundId of [...soundSources.keys()].sort()) {
    const metadata = soundSources.get(soundId)!
    manifest[soundId] = {
      kind: 'url',
      preload: metadata.preload,
      stream: metadata.stream,
      url: minecraftSoundAssetUrl(soundId, baseUrl),
    }
  }
  return manifest
}


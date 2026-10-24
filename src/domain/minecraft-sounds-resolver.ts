import {
  type AudioSampleId,
  type AudioSampleUrl,
  type MinecraftSoundEventId,
  type MinecraftSoundResourceId,
  AudioGain as makeAudioGain,
  AudioPlaybackRate as makeAudioPlaybackRate,
  AudioSampleId as makeAudioSampleId,
  AudioSampleUrl as makeAudioSampleUrl,
} from './audio-brands.js'
import type { AudioSampleManifest, AudioSampleSource } from './audio-sample.js'
import type {
  MinecraftSoundEvent,
  MinecraftSoundRegistry,
  MinecraftSoundVariant,
  ResolvedMinecraftSound,
} from './minecraft-sounds-types.js'
import { Result } from 'effect'

const DEFAULT_RANDOM = 0
const MIN_RANDOM = 0
const MAX_RANDOM_BOUND = 1
const MAX_RANDOM = MAX_RANDOM_BOUND - Number.EPSILON
const INDEX_STEP = 1
const RESOURCE_SEPARATOR = ':'

export type MinecraftSoundResolutionFailure = {
  readonly _tag: 'MinecraftSoundResolutionFailure'
  readonly eventId: MinecraftSoundEventId
  readonly message: string
}

type ResolveEventOptions = {
  readonly eventId: MinecraftSoundEventId
  readonly random: number
  readonly registry: MinecraftSoundRegistry
  readonly rootEventId: MinecraftSoundEventId
  readonly visited: ReadonlySet<MinecraftSoundEventId>
}

type ResolveEvent = (
  options: ResolveEventOptions,
) => Result.Result<ResolvedMinecraftSound, MinecraftSoundResolutionFailure>

type SoundManifestMetadata = {
  readonly preload: boolean
  readonly stream: boolean
}

type CollectSoundSourcesOptions = {
  readonly eventId: MinecraftSoundEventId
  readonly registry: MinecraftSoundRegistry
  readonly soundSources: Map<MinecraftSoundResourceId, SoundManifestMetadata>
  readonly visited: ReadonlySet<MinecraftSoundEventId>
  readonly inherited: SoundManifestMetadata
}

const failure = (eventId: MinecraftSoundEventId, message: string): Result.Result<never, MinecraftSoundResolutionFailure> =>
  Result.fail({ _tag: 'MinecraftSoundResolutionFailure', eventId, message })

const normalizeRandom = (random: number): number => {
  if (!Number.isFinite(random)) {
    return DEFAULT_RANDOM
  }
  return Math.min(MAX_RANDOM, Math.max(MIN_RANDOM, random))
}

const selectWeightedVariant = (
  variants: readonly [MinecraftSoundVariant, ...MinecraftSoundVariant[]],
  initialWeight: number,
): MinecraftSoundVariant => {
  let remaining = initialWeight
  const [firstVariant] = variants
  let lastVariant = firstVariant
  for (const variant of variants) {
    lastVariant = variant
    if (remaining < variant.weight) {
      return variant
    }
    remaining -= variant.weight
  }

  return lastVariant
}

const selectFromNonEmptyVariants = (
  variants: readonly [MinecraftSoundVariant, ...MinecraftSoundVariant[]],
  random: number,
): Result.Result<MinecraftSoundVariant, MinecraftSoundResolutionFailure> => {
  const totalWeight = variants.reduce((total, variant) => total + variant.weight, DEFAULT_RANDOM)
  const selected = selectWeightedVariant(variants, normalizeRandom(random) * totalWeight)
  return Result.succeed(selected)
}

export const selectMinecraftSoundVariant = (
  event: MinecraftSoundEvent,
  random: number = DEFAULT_RANDOM,
): Result.Result<MinecraftSoundVariant, MinecraftSoundResolutionFailure> => {
  const [firstVariant] = event.sounds
  if (firstVariant === globalThis.undefined) {
    return failure(event.id, `Sound event ${event.id} has no sound variants`)
  }

  const variants: readonly [MinecraftSoundVariant, ...MinecraftSoundVariant[]] = [
    firstVariant,
    ...event.sounds.slice(INDEX_STEP),
  ]
  return selectFromNonEmptyVariants(variants, random)
}

const combineResolvedSound = (
  rootEventId: MinecraftSoundEventId,
  variant: MinecraftSoundVariant,
  resolved: ResolvedMinecraftSound,
): Result.Result<ResolvedMinecraftSound, MinecraftSoundResolutionFailure> => {
  const pitch = makeAudioPlaybackRate.result(variant.pitch * resolved.pitch)
  if (Result.isFailure(pitch)) {
    return failure(rootEventId, pitch.failure.message)
  }
  const volume = makeAudioGain.result(variant.volume * resolved.volume)
  if (Result.isFailure(volume)) {
    return failure(rootEventId, volume.failure.message)
  }
  return Result.succeed({
    ...resolved,
    attenuationDistance: variant.attenuationDistance,
    pitch: pitch.success,
    preload: variant.preload || resolved.preload,
    stream: variant.stream || resolved.stream,
    volume: volume.success,
  })
}

const resolveSelectedVariant = (
  variant: MinecraftSoundVariant,
  options: ResolveEventOptions,
  resolveEvent: ResolveEvent,
): Result.Result<ResolvedMinecraftSound, MinecraftSoundResolutionFailure> => {
  const { random, registry, rootEventId, visited } = options
  if (variant.type === 'sound') {
    return Result.succeed({
      attenuationDistance: variant.attenuationDistance,
      eventId: rootEventId,
      pitch: variant.pitch,
      preload: variant.preload,
      soundId: variant.name,
      stream: variant.stream,
      volume: variant.volume,
    })
  }

  const resolved = resolveEvent({
    eventId: variant.name,
    random,
    registry,
    rootEventId,
    visited,
  })
  if (Result.isFailure(resolved)) {
    return resolved
  }
  return combineResolvedSound(rootEventId, variant, resolved.success)
}

const resolveEvent = ({ eventId, random, registry, rootEventId, visited }: ResolveEventOptions): Result.Result<ResolvedMinecraftSound, MinecraftSoundResolutionFailure> => {
  if (visited.has(eventId)) {
    return failure(eventId, `Cyclic Minecraft sound event reference: ${[...visited, eventId].join(' -> ')}`)
  }
  const event = registry.events.get(eventId)
  if (event === globalThis.undefined) {
    return failure(eventId, `Unknown Minecraft sound event: ${eventId}`)
  }
  const nextVisited = new Set(visited).add(eventId)
  const selected = selectMinecraftSoundVariant(event, random)
  if (Result.isFailure(selected)) {
    return Result.fail(selected.failure)
  }
  return resolveSelectedVariant(selected.success, { eventId, random, registry, rootEventId, visited: nextVisited }, resolveEvent)
}

export const resolveMinecraftSound = (
  registry: MinecraftSoundRegistry,
  eventId: MinecraftSoundEventId,
  random: number = DEFAULT_RANDOM,
): Result.Result<ResolvedMinecraftSound, MinecraftSoundResolutionFailure> => resolveEvent({
  eventId,
  random,
  registry,
  rootEventId: eventId,
  visited: new Set<MinecraftSoundEventId>(),
})

type CollectSoundSources = (
  options: CollectSoundSourcesOptions,
) => Result.Result<void, MinecraftSoundResolutionFailure>

type CollectVariantSoundSourceOptions = Pick<CollectSoundSourcesOptions, 'registry' | 'soundSources' | 'visited'> & {
  readonly collectSources: CollectSoundSources
}

const collectVariantSoundSource = (
  variant: MinecraftSoundVariant,
  metadata: SoundManifestMetadata,
  options: CollectVariantSoundSourceOptions,
): Result.Result<void, MinecraftSoundResolutionFailure> => {
  const { registry, soundSources, visited, collectSources } = options
  if (variant.type === 'event') {
    return collectSources({ eventId: variant.name, inherited: metadata, registry, soundSources, visited })
  }

  const previous = soundSources.get(variant.name)
  soundSources.set(variant.name, {
    preload: metadata.preload || previous?.preload === true,
    stream: metadata.stream || previous?.stream === true,
  })
  return Result.succeed(globalThis.undefined)
}

const collectEventSoundSources = (
  variants: readonly MinecraftSoundVariant[],
  options: Omit<CollectSoundSourcesOptions, 'eventId'>,
  collectSources: CollectSoundSources,
): Result.Result<void, MinecraftSoundResolutionFailure> => {
  const { registry, soundSources, visited, inherited } = options
  for (const variant of variants) {
    const metadata = {
      preload: inherited.preload || variant.preload,
      stream: inherited.stream || variant.stream,
    }
    const collected = collectVariantSoundSource(variant, metadata, { collectSources, registry, soundSources, visited })
    if (Result.isFailure(collected)) {
      return Result.fail(collected.failure)
    }
  }
  return Result.succeed(globalThis.undefined)
}

const collectSoundSources = ({ eventId, registry, soundSources, visited, inherited }: CollectSoundSourcesOptions): Result.Result<void, MinecraftSoundResolutionFailure> => {
  if (visited.has(eventId)) {
    return failure(eventId, `Cyclic Minecraft sound event reference: ${[...visited, eventId].join(' -> ')}`)
  }
  const event = registry.events.get(eventId)
  if (event === globalThis.undefined) {
    return failure(eventId, `Unknown Minecraft sound event: ${eventId}`)
  }
  const nextVisited = new Set(visited).add(eventId)
  return collectEventSoundSources(event.sounds, { inherited, registry, soundSources, visited: nextVisited }, collectSoundSources)
}

export const minecraftSoundAssetUrl = (
  soundId: MinecraftSoundResourceId,
  baseUrl: AudioSampleUrl,
): AudioSampleUrl => {
  const separator = soundId.indexOf(RESOURCE_SEPARATOR)
  const namespace = soundId.slice(DEFAULT_RANDOM, separator)
  const soundPath = soundId.slice(separator + INDEX_STEP)
  const prefix = baseUrl.replace(/\/+$/u, '')
  return makeAudioSampleUrl(`${prefix}/assets/${namespace}/sounds/${soundPath}.ogg`)
}

const collectRegistrySoundSources = (
  registry: MinecraftSoundRegistry,
): Result.Result<Map<MinecraftSoundResourceId, SoundManifestMetadata>, MinecraftSoundResolutionFailure> => {
  const soundSources = new Map<MinecraftSoundResourceId, SoundManifestMetadata>()
  for (const eventId of registry.events.keys()) {
    const collected = collectSoundSources({
      eventId,
      inherited: { preload: false, stream: false },
      registry,
      soundSources,
      visited: new Set<MinecraftSoundEventId>(),
    })
    if (Result.isFailure(collected)) {
      return Result.fail(collected.failure)
    }
  }
  return Result.succeed(soundSources)
}

const manifestFromSoundSources = (
  soundSources: ReadonlyMap<MinecraftSoundResourceId, SoundManifestMetadata>,
  baseUrl: AudioSampleUrl,
): AudioSampleManifest => {
  const manifest = new Map<AudioSampleId, AudioSampleSource>()
  const sortedSources = [...soundSources.entries()].sort(([left], [right]) => left.localeCompare(right))
  for (const [soundId, metadata] of sortedSources) {
    const id = makeAudioSampleId(soundId)
    manifest.set(id, {
      kind: 'url',
      preload: metadata.preload,
      stream: metadata.stream,
      url: minecraftSoundAssetUrl(soundId, baseUrl),
    })
  }
  return manifest
}

export const minecraftSoundManifest = (
  registry: MinecraftSoundRegistry,
  baseUrl: AudioSampleUrl,
): Result.Result<AudioSampleManifest, MinecraftSoundResolutionFailure> => Result.map(
  collectRegistrySoundSources(registry),
  (soundSources) => manifestFromSoundSources(soundSources, baseUrl),
)

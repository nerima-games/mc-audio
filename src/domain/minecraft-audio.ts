import { type AudioVolume, AudioVolume as makeAudioVolume } from './audio-brands.js'
import {
  type BlockId,
  type BlockRegistryResolutionFailure,
  isKnownBlockId,
  transmitsLight,
} from '@nerima-games/mc-kernel/domain/block-registry'
import {
  type MinecraftAmbientSoundsDefinition,
  type MinecraftAmbientSoundsFailure,
  type NormalizedMinecraftAmbientSoundsDefinition,
  normalizeMinecraftAmbientSoundsDefinition,
} from './minecraft-ambient-sounds.js'
import {
  type MinecraftBackgroundMusic,
  type MinecraftBackgroundMusicEntry,
  type MinecraftBackgroundMusicInput,
  type MinecraftBackgroundMusicKey,
  type MinecraftMusicDataFailure,
  normalizeMinecraftMusicDefinition,
} from './minecraft-music.js'
import { Result } from 'effect'

export const MINECRAFT_AUDIO_COMPONENT_NAMES = [
  'minecraft:audio/ambient_sounds',
  'minecraft:audio/background_music',
  'minecraft:audio/firefly_bush_sounds',
  'minecraft:audio/music_volume',
] as const

export type MinecraftAudioComponentName = (typeof MINECRAFT_AUDIO_COMPONENT_NAMES)[number]

export type MinecraftAudioComponent = {
  readonly 'minecraft:audio/ambient_sounds'?: MinecraftAmbientSoundsDefinition
  readonly 'minecraft:audio/background_music'?: MinecraftBackgroundMusicInput
  readonly 'minecraft:audio/firefly_bush_sounds'?: boolean
  readonly 'minecraft:audio/music_volume'?: number
}

export type NormalizedMinecraftAudioComponent = {
  readonly ambientSounds: NormalizedMinecraftAmbientSoundsDefinition | null
  readonly backgroundMusic: MinecraftBackgroundMusic | null
  readonly fireflyBushSounds: boolean | null
  readonly musicVolume: AudioVolume | null
}

export type MinecraftAudioComponentFailure = {
  readonly _tag: 'MinecraftAudioComponentFailure'
  readonly path: string
  readonly message: string
}

export type MinecraftAudioFailure =
  | MinecraftAudioComponentFailure
  | MinecraftAmbientSoundsFailure
  | MinecraftMusicDataFailure
  | BlockRegistryResolutionFailure

export type MinecraftFireflyBushSoundContext = {
  readonly fireflyBushSounds: boolean | null
  readonly belowBlockId?: BlockId
  readonly belowOpaqueBlock: boolean
}

export type UnknownMinecraftAudioBlockFailure = {
  readonly _tag: 'UnknownMinecraftAudioBlockFailure'
  readonly blockId: BlockId
}

export type MinecraftFireflyBushSoundFailure = BlockRegistryResolutionFailure | UnknownMinecraftAudioBlockFailure

const BACKGROUND_MUSIC_KEYS = ['default', 'underwater', 'creative'] as const
const ZERO = 0
const ONE = 1

type JsonObject = Record<string, unknown>

const failure = (path: string, message: string): Result.Result<never, MinecraftAudioComponentFailure> =>
  Result.fail({ _tag: 'MinecraftAudioComponentFailure', message, path })

const emptyAudioComponent = (): NormalizedMinecraftAudioComponent => ({
  ambientSounds: null,
  backgroundMusic: null,
  fireflyBushSounds: null,
  musicVolume: null,
})

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null

const isMissing = (value: unknown): value is undefined => Object.is(value, globalThis.undefined)

const isBackgroundMusicKey = (value: string): value is MinecraftBackgroundMusicKey =>
  BACKGROUND_MUSIC_KEYS.some((key) => key === value)

const normalizeBackgroundMusicEntry = (
  key: MinecraftBackgroundMusicKey,
  value: unknown,
): Result.Result<MinecraftBackgroundMusicEntry, MinecraftAudioFailure> => {
  if (!isRecord(value) || Array.isArray(value)) {
    return failure(`minecraft:audio/background_music.${key}`, `Minecraft background_music.${key} must be an object`)
  }
  if (Object.keys(value).length === ZERO) {
    return Result.succeed(null)
  }
  return Result.mapError(normalizeMinecraftMusicDefinition(value), (cause) => cause)
}

const normalizeBackgroundMusicEntries = (
  value: JsonObject,
): Result.Result<MinecraftBackgroundMusic, MinecraftAudioFailure> => {
  const normalized: Partial<Record<MinecraftBackgroundMusicKey, MinecraftBackgroundMusicEntry>> = {}
  for (const key of Object.keys(value)) {
    if (!isBackgroundMusicKey(key)) {
      return failure(`minecraft:audio/background_music.${key}`, `Unknown Minecraft background_music key: ${key}`)
    }
    const rawEntry = value[key]
    const entry = normalizeBackgroundMusicEntry(key, rawEntry)
    if (Result.isFailure(entry)) {
      return Result.fail(entry.failure)
    }
    normalized[key] = entry.success
  }
  return Result.succeed(normalized)
}

const normalizeBackgroundMusic = (
  value: unknown,
): Result.Result<MinecraftBackgroundMusic | null, MinecraftAudioFailure> => {
  if (isMissing(value)) {
    return Result.succeed(null)
  }
  if (!isRecord(value) || Array.isArray(value)) {
    return failure('minecraft:audio/background_music', 'Minecraft background_music must be an object')
  }
  return normalizeBackgroundMusicEntries(value)
}

const normalizeMusicVolume = (value: unknown): Result.Result<AudioVolume | null, MinecraftAudioComponentFailure> => {
  if (isMissing(value)) {
    return Result.succeed(null)
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < ZERO || value > ONE) {
    return failure('minecraft:audio/music_volume', 'Minecraft music_volume must be a finite number from 0 through 1')
  }
  return Result.succeed(makeAudioVolume(value))
}

const normalizeFireflyBushSounds = (value: unknown): Result.Result<boolean | null, MinecraftAudioComponentFailure> => {
  if (isMissing(value)) {
    return Result.succeed(null)
  }
  if (typeof value === 'boolean') {
    return Result.succeed(value)
  }
  return failure('minecraft:audio/firefly_bush_sounds', 'Minecraft firefly_bush_sounds must be a boolean')
}

const normalizeAmbientSounds = (
  value: unknown,
): Result.Result<NormalizedMinecraftAmbientSoundsDefinition | null, MinecraftAudioFailure> => {
  if (isMissing(value)) {
    return Result.succeed(null)
  }
  if (!isRecord(value) || Array.isArray(value)) {
    return failure('minecraft:audio/ambient_sounds', 'Minecraft ambient_sounds must be an object')
  }
  return normalizeMinecraftAmbientSoundsDefinition(value)
}

const validateComponentKeys = (value: JsonObject): Result.Result<void, MinecraftAudioComponentFailure> => {
  for (const key of Object.keys(value)) {
    if (!MINECRAFT_AUDIO_COMPONENT_NAMES.some((knownKey) => knownKey === key)) {
      return failure(key, `Unknown Minecraft audio component: ${key}`)
    }
  }
  return Result.succeed(globalThis.undefined)
}

type MinecraftAudioComponentSnapshot = {
  readonly ambientSounds: unknown
  readonly backgroundMusic: unknown
  readonly fireflyBushSounds: unknown
  readonly musicVolume: unknown
}

const snapshotAudioComponent = (value: JsonObject): MinecraftAudioComponentSnapshot => ({
  ambientSounds: value['minecraft:audio/ambient_sounds'],
  backgroundMusic: value['minecraft:audio/background_music'],
  fireflyBushSounds: value['minecraft:audio/firefly_bush_sounds'],
  musicVolume: value['minecraft:audio/music_volume'],
})

const normalizeComponentSnapshot = (
  snapshot: MinecraftAudioComponentSnapshot,
): Result.Result<NormalizedMinecraftAudioComponent, MinecraftAudioFailure> => Result.gen(function* normalizeComponentSnapshotEffect() {
  const ambientSounds = yield* normalizeAmbientSounds(snapshot.ambientSounds)
  const backgroundMusic = yield* normalizeBackgroundMusic(snapshot.backgroundMusic)
  const fireflyBushSounds = yield* normalizeFireflyBushSounds(snapshot.fireflyBushSounds)
  const musicVolume = yield* normalizeMusicVolume(snapshot.musicVolume)
  return {
    ambientSounds,
    backgroundMusic,
    fireflyBushSounds,
    musicVolume,
  }
})

const normalizeRecord = (
  value: JsonObject,
): Result.Result<NormalizedMinecraftAudioComponent, MinecraftAudioFailure> => {
  const keysResult = validateComponentKeys(value)
  if (Result.isFailure(keysResult)) {
    return Result.fail(keysResult.failure)
  }
  const snapshot = snapshotAudioComponent(value)
  return normalizeComponentSnapshot(snapshot)
}

export const parseMinecraftAudioComponent = (
  value: unknown,
): Result.Result<NormalizedMinecraftAudioComponent, MinecraftAudioFailure> => {
  if (!isRecord(value) || Array.isArray(value)) {
    return failure('$', 'Minecraft audio component must be an object')
  }
  return normalizeRecord(value)
}

export const normalizeMinecraftAudioComponent = (
  value?: MinecraftAudioComponent | null,
): Result.Result<NormalizedMinecraftAudioComponent, MinecraftAudioFailure> => {
  if (isMissing(value) || value === null) {
    return Result.succeed(emptyAudioComponent())
  }
  return parseMinecraftAudioComponent(value)
}

export const canPlayMinecraftFireflyBushIdleSounds = ({
  fireflyBushSounds,
  belowBlockId,
  belowOpaqueBlock,
}: MinecraftFireflyBushSoundContext): Result.Result<boolean, MinecraftFireflyBushSoundFailure> => {
  if (fireflyBushSounds !== true) {
    return Result.succeed(false)
  }
  if (belowBlockId === globalThis.undefined) {
    return Result.succeed(!belowOpaqueBlock)
  }
  return Result.gen(function* canPlayMinecraftFireflyBushIdleSoundsEffect() {
    const known = yield* isKnownBlockId(belowBlockId)
    if (!known) {
      return yield* Result.fail({ _tag: 'UnknownMinecraftAudioBlockFailure' as const, blockId: belowBlockId })
    }
    return yield* transmitsLight(belowBlockId)
  })
}

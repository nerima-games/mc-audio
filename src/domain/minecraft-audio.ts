import { type BlockId, isKnownBlockId, transmitsLight } from '@nerima-games/mc-kernel'
import {
  type MinecraftAmbientSoundsDefinition,
  type NormalizedMinecraftAmbientSoundsDefinition,
  normalizeMinecraftAmbientSoundsDefinition,
} from './minecraft-ambient-sounds.js'
import {
  type MinecraftBackgroundMusic,
  type MinecraftBackgroundMusicEntry,
  type MinecraftBackgroundMusicInput,
  type MinecraftBackgroundMusicKey,
  type MinecraftMusicDefinition,
  normalizeMinecraftMusicDefinition,
} from './minecraft-music.js'

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
  readonly musicVolume: number | null
}

export type MinecraftFireflyBushSoundContext = {
  readonly fireflyBushSounds: boolean | null
  readonly belowBlockId?: BlockId
  readonly belowOpaqueBlock: boolean
}

const BACKGROUND_MUSIC_KEYS = ['default', 'underwater', 'creative'] as const
const ZERO = 0
const ONE = 1

const isOpaqueBlockBelow = (belowBlockId: BlockId | void, fallback: boolean): boolean => {
  if (typeof belowBlockId !== 'number') {
    return fallback
  }
  if (!isKnownBlockId(belowBlockId)) {
    throw new RangeError(`Unknown Minecraft block id: ${belowBlockId}`)
  }
  return !transmitsLight(belowBlockId)
}

const emptyAudioComponent = (): NormalizedMinecraftAudioComponent => ({
  ambientSounds: null,
  backgroundMusic: null,
  fireflyBushSounds: null,
  musicVolume: null,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isMissing = (value: unknown): value is undefined => Object.is(value, globalThis.undefined)

const isBackgroundMusicKey = (value: string): value is MinecraftBackgroundMusicKey =>
  BACKGROUND_MUSIC_KEYS.some((key) => key === value)

const assertBackgroundMusicKey = (key: string): void => {
  if (!isBackgroundMusicKey(key)) {
    throw new RangeError(`Unknown Minecraft background_music key: ${key}`)
  }
}

const normalizeBackgroundMusicEntry = (
  key: MinecraftBackgroundMusicKey,
  value: unknown,
): MinecraftBackgroundMusicEntry => {
  if (!isRecord(value) || Array.isArray(value)) {
    throw new TypeError(`Minecraft background_music.${key} must be an object`)
  }
  if (Object.keys(value).length === ZERO) {
    return null
  }
  return normalizeMinecraftMusicDefinition(value as MinecraftMusicDefinition)
}

const normalizeBackgroundMusic = (value: unknown): MinecraftBackgroundMusic | null => {
  if (isMissing(value)) {
    return null
  }
  if (!isRecord(value) || Array.isArray(value)) {
    throw new TypeError('Minecraft background_music must be an object')
  }
  Object.keys(value).forEach(assertBackgroundMusicKey)
  const normalized: Partial<Record<MinecraftBackgroundMusicKey, MinecraftBackgroundMusicEntry>> = {}
  BACKGROUND_MUSIC_KEYS.forEach((key) => {
    if (Object.hasOwn(value, key)) {
      normalized[key] = normalizeBackgroundMusicEntry(key, value[key])
    }
  })
  return normalized
}

const normalizeMusicVolume = (value: unknown): number | null => {
  if (isMissing(value)) {
    return null
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < ZERO || value > ONE) {
    throw new RangeError('Minecraft music_volume must be a finite number from 0 through 1')
  }
  return value
}

const normalizeFireflyBushSounds = (value: unknown): boolean | null => {
  if (isMissing(value)) {
    return null
  }
  if (typeof value !== 'boolean') {
    throw new TypeError('Minecraft firefly_bush_sounds must be a boolean')
  }
  return value
}

const normalizeAmbientSounds = (
  value: unknown,
): NormalizedMinecraftAmbientSoundsDefinition | null => {
  if (isMissing(value)) {
    return null
  }
  if (!isRecord(value) || Array.isArray(value)) {
    throw new TypeError('Minecraft ambient_sounds must be an object')
  }
  return normalizeMinecraftAmbientSoundsDefinition(value as MinecraftAmbientSoundsDefinition)
}

const normalizeRecord = (value: Record<string, unknown>): NormalizedMinecraftAudioComponent => {
  for (const key of Object.keys(value)) {
    if (!MINECRAFT_AUDIO_COMPONENT_NAMES.some((knownKey) => knownKey === key)) {
      throw new RangeError(`Unknown Minecraft audio component: ${key}`)
    }
  }
  return {
    ambientSounds: normalizeAmbientSounds(value['minecraft:audio/ambient_sounds']),
    backgroundMusic: normalizeBackgroundMusic(value['minecraft:audio/background_music']),
    fireflyBushSounds: normalizeFireflyBushSounds(value['minecraft:audio/firefly_bush_sounds']),
    musicVolume: normalizeMusicVolume(value['minecraft:audio/music_volume']),
  }
}

export const parseMinecraftAudioComponent = (value: unknown): NormalizedMinecraftAudioComponent => {
  if (!isRecord(value) || Array.isArray(value)) {
    throw new TypeError('Minecraft audio component must be an object')
  }
  return normalizeRecord(value)
}

export const normalizeMinecraftAudioComponent = (
  value?: MinecraftAudioComponent | null,
): NormalizedMinecraftAudioComponent => {
  if (isMissing(value) || value === null) {
    return emptyAudioComponent()
  }
  return parseMinecraftAudioComponent(value)
}

export const canPlayMinecraftFireflyBushIdleSounds = ({
  fireflyBushSounds,
  belowBlockId,
  belowOpaqueBlock,
}: MinecraftFireflyBushSoundContext): boolean =>
  fireflyBushSounds === true && !isOpaqueBlockBelow(belowBlockId, belowOpaqueBlock)

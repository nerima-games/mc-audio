import type {
  AudioDistance,
  AudioGain,
  AudioPlaybackRate,
  AudioWeight,
  MinecraftSoundEventId,
  MinecraftSoundNamespace,
  MinecraftSoundResourceId,
} from './audio-brands.js'

export type MinecraftSoundReferenceType = 'sound' | 'event'

export type MinecraftSoundVariant = {
  readonly volume: AudioGain
  readonly pitch: AudioPlaybackRate
  readonly weight: AudioWeight
  readonly stream: boolean
  readonly attenuationDistance: AudioDistance
  readonly preload: boolean
} & (
  | { readonly name: MinecraftSoundResourceId; readonly type: 'sound' }
  | { readonly name: MinecraftSoundEventId; readonly type: 'event' }
)

export type MinecraftSoundEvent = {
  readonly id: MinecraftSoundEventId
  readonly replace: boolean
  readonly subtitle: string | null
  readonly sounds: readonly MinecraftSoundVariant[]
}

export type MinecraftSoundRegistry = {
  readonly events: ReadonlyMap<MinecraftSoundEventId, MinecraftSoundEvent>
}

export type MinecraftSoundRegistryOptions = {
  readonly namespace: MinecraftSoundNamespace
}

export type ResolvedMinecraftSound = {
  readonly eventId: MinecraftSoundEventId
  readonly soundId: MinecraftSoundResourceId
  readonly volume: AudioGain
  readonly pitch: AudioPlaybackRate
  readonly stream: boolean
  readonly attenuationDistance: AudioDistance
  readonly preload: boolean
}


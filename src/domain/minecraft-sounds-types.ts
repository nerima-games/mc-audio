export type MinecraftSoundReferenceType = 'sound' | 'event'

export type MinecraftSoundVariant = {
  readonly name: string
  readonly type: MinecraftSoundReferenceType
  readonly volume: number
  readonly pitch: number
  readonly weight: number
  readonly stream: boolean
  readonly attenuationDistance: number
  readonly preload: boolean
}

export type MinecraftSoundEvent = {
  readonly id: string
  readonly replace: boolean
  readonly subtitle: string | null
  readonly sounds: readonly MinecraftSoundVariant[]
}

export type MinecraftSoundRegistry = {
  readonly events: Readonly<Record<string, MinecraftSoundEvent>>
}

export type MinecraftSoundRegistryOptions = {
  readonly namespace: string
}

export type ResolvedMinecraftSound = {
  readonly eventId: string
  readonly soundId: string
  readonly volume: number
  readonly pitch: number
  readonly stream: boolean
  readonly attenuationDistance: number
  readonly preload: boolean
}

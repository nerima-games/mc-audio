import officialSounds from './minecraft-26-3-snapshot-9-sounds.json' with { type: 'json' }

export type Minecraft26_3Snapshot9SoundVariantDefinition =
  | string
  | {
      readonly name: string
      readonly type?: 'sound' | 'event'
      readonly volume?: number
      readonly pitch?: number
      readonly weight?: number
      readonly stream?: boolean
      readonly attenuation_distance?: number
      readonly preload?: boolean
    }

export type Minecraft26_3Snapshot9SoundDefinition = {
  readonly sounds: readonly Minecraft26_3Snapshot9SoundVariantDefinition[]
  readonly subtitle?: string
  readonly replace?: boolean
}

type Minecraft26_3Snapshot9SoundData = {
  readonly [Key in keyof typeof officialSounds]: Minecraft26_3Snapshot9SoundDefinition
}

export const MINECRAFT_26_3_SNAPSHOT_9_SOUNDS_JSON = officialSounds as unknown as Minecraft26_3Snapshot9SoundData

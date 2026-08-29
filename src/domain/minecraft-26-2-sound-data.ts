import officialSounds from './minecraft-26-2-sounds.json' with { type: 'json' }

export type Minecraft26_2SoundVariantDefinition =
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

export type Minecraft26_2SoundDefinition = {
  readonly sounds: readonly Minecraft26_2SoundVariantDefinition[]
  readonly subtitle?: string
  readonly replace?: boolean
}

type Minecraft26_2SoundData = {
  readonly [Key in keyof typeof officialSounds]: Minecraft26_2SoundDefinition
}

export const MINECRAFT_26_2_SOUNDS_JSON = officialSounds as unknown as Minecraft26_2SoundData


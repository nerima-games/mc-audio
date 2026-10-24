// A `.ts` module rather than a `.json` import with `with { type: 'json' }`:
// TypeScript's declaration emit drops import attributes from the emitted
// `.d.ts` (verified: `tsc -p tsconfig.release.json` produced a bare
// `import officialSounds from './minecraft-26-2-sounds-raw.js'` with no
// Attribute, regardless of the emitting project's own `module`/
// `moduleResolution`), which then fails to typecheck for any downstream
// Consumer resolving under NodeNext — caught by
// Scripts/verify-package.mjs's declaration-consumer check (TS1543).
import officialSounds from './minecraft-26-2-sounds-raw.js'

export type Minecraft26_2SoundVariantDefinition =
  | string
  | {
  readonly name: unknown
      readonly type?: 'sound' | 'event'
  readonly volume?: unknown
  readonly pitch?: unknown
  readonly weight?: unknown
      readonly stream?: boolean
  readonly attenuation_distance?: unknown
      readonly preload?: boolean
    }

export type Minecraft26_2SoundDefinition = {
  readonly sounds: readonly Minecraft26_2SoundVariantDefinition[]
  readonly subtitle?: unknown
  readonly replace?: boolean
}

type Minecraft26_2SoundData = {
  readonly [Key in keyof typeof officialSounds]: Minecraft26_2SoundDefinition
}

export const MINECRAFT_26_2_SOUNDS_JSON: Minecraft26_2SoundData = officialSounds satisfies Minecraft26_2SoundData

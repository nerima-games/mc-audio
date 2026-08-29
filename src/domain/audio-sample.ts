/** Host-neutral sample data exchanged by resource loaders and audio backends. */
export type AudioSampleSource =
  | {
      readonly kind: 'array-buffer'
      readonly data: ArrayBuffer
      readonly preload?: boolean
      readonly stream?: boolean
    }
  | {
      readonly kind: 'url'
      readonly preload?: boolean
      readonly stream?: boolean
      readonly url: string
    }

export type AudioSampleManifest = Readonly<Record<string, AudioSampleSource>>

export const mergeAudioSampleManifests = (
  base: AudioSampleManifest,
  additions: AudioSampleManifest,
): AudioSampleManifest => ({
  ...additions,
  ...base,
})

export type AudioSampleLoadReport = {
  readonly requested: number
  readonly loaded: number
  readonly cached: number
  readonly failed: number
}


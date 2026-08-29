export const MUSIC_ENVIRONMENTS = ['day', 'night', 'cave'] as const

export type MusicEnvironment = (typeof MUSIC_ENVIRONMENTS)[number]

export type MusicTrack = {
  readonly baseGain: number
  readonly frequency: number
}

export const MUSIC_TRACKS: Readonly<Record<MusicEnvironment, MusicTrack>> = {
  cave: { baseGain: 0.2, frequency: 98 },
  day: { baseGain: 0.28, frequency: 174.61 },
  night: { baseGain: 0.24, frequency: 130.81 },
}


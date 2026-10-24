import {
  type AudioFrequencyHz,
  type AudioGain,
  AudioFrequencyHz as makeAudioFrequencyHz,
  AudioGain as makeAudioGain,
} from '../domain/audio-brands.js'

export const MUSIC_ENVIRONMENTS = ['day', 'night', 'cave'] as const

export type MusicEnvironment = (typeof MUSIC_ENVIRONMENTS)[number]

export type MusicTrack = {
  readonly baseGain: AudioGain
  readonly frequency: AudioFrequencyHz
}

const CAVE_BASE_GAIN = 0.2
const CAVE_FREQUENCY_HZ = 98
const DAY_BASE_GAIN = 0.28
const DAY_FREQUENCY_HZ = 174.61
const NIGHT_BASE_GAIN = 0.24
const NIGHT_FREQUENCY_HZ = 130.81

export const MUSIC_TRACKS: Readonly<Record<MusicEnvironment, MusicTrack>> = {
  cave: { baseGain: makeAudioGain(CAVE_BASE_GAIN), frequency: makeAudioFrequencyHz(CAVE_FREQUENCY_HZ) },
  day: { baseGain: makeAudioGain(DAY_BASE_GAIN), frequency: makeAudioFrequencyHz(DAY_FREQUENCY_HZ) },
  night: { baseGain: makeAudioGain(NIGHT_BASE_GAIN), frequency: makeAudioFrequencyHz(NIGHT_FREQUENCY_HZ) },
}


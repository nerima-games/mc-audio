/* oxlint-disable max-statements, no-bitwise, no-magic-numbers, no-nested-ternary, no-ternary, prefer-destructuring -- PCM/WAV synthesis is intentionally numeric and stateful. */
import {
  type AudioCount,
  type AudioDurationSecs,
  type AudioFrequencyHz,
  type AudioSampleId,
  type AudioSampleRate,
  type AudioSeed,
  AudioCount as makeAudioCount,
  AudioDurationSecs as makeAudioDurationSecs,
  AudioFrequencyHz as makeAudioFrequencyHz,
  AudioSampleId as makeAudioSampleId,
  AudioSampleRate as makeAudioSampleRate,
  AudioSeed as makeAudioSeed,
} from './audio-brands.js'
import type { AudioSampleManifest, AudioSampleSource } from './audio-sample.js'
import { END_AUDIO_EVENT_KINDS, END_SOUND_DEFINITIONS, type EndAudioEventKind } from './end-audio.js'
import { SOUND_CUE_IDS, type SoundCueId, cueDefinition } from './cue.js'
import { Option } from 'effect'

export const ORIGINAL_SAMPLE_RATE: AudioSampleRate = makeAudioSampleRate(16_000)

export const ORIGINAL_SAMPLE_SOUND_IDS: readonly (SoundCueId | EndAudioEventKind | 'endAmbience')[] = [
  ...SOUND_CUE_IDS,
  ...END_AUDIO_EVENT_KINDS,
  'endAmbience',
]

export type OriginalSampleSoundId = (typeof ORIGINAL_SAMPLE_SOUND_IDS)[number]

export type OriginalSampleBankOptions = {
  /** Samples per second. Defaults to 16 kHz; values outside 8-48 kHz are clamped. */
  readonly sampleRate?: AudioSampleRate
  /** Changes the generated performance while remaining deterministic. */
  readonly seed?: AudioSeed
}

type SampleSpec = {
  readonly durationSecs: AudioDurationSecs
  readonly frequency: AudioFrequencyHz
  readonly noise: number
  readonly sweep: number
}

const endSpec = (id: EndAudioEventKind): SampleSpec => {
  const value = END_SOUND_DEFINITIONS[id]
  return {
    durationSecs: makeAudioDurationSecs(Math.min(value.durationSecs, 1.5)),
    frequency: value.fallbackFrequency,
    noise: id.startsWith('dragon') ? 0.52 : 0.18,
    sweep: id === 'portalActivate' || id === 'exitPortal' ? 1.8 : 0.62,
  }
}

const cueSpec = (id: SoundCueId): SampleSpec => {
  const value = cueDefinition(id)
  const noisy = id.startsWith('footstep') || id.startsWith('block') || id.includes('Hurt') || id.includes('Death')
  return {
    durationSecs: value.durationSecs,
    frequency: value.frequency,
    noise: noisy ? 0.6 : id === 'rainAmbient' || id === 'thunderClap' ? 0.75 : 0.12,
    sweep: id === 'thunderClap' ? 0.28 : 1.15,
  }
}

const isSoundCueId = (id: OriginalSampleSoundId): id is SoundCueId =>
  SOUND_CUE_IDS.some((cueId) => cueId === id)

const specFor = (id: OriginalSampleSoundId): SampleSpec => {
  if (id === 'endAmbience') {
    return { durationSecs: makeAudioDurationSecs(1.5), frequency: makeAudioFrequencyHz(46), noise: 0.16, sweep: 1.04 }
  }
  if (isSoundCueId(id)) {
    return cueSpec(id)
  }
  return endSpec(id)
}

const hash = (text: string, seed: number): number => {
  let state = seed | 0
  for (const character of text) {
    state = Math.imul(state ^ character.charCodeAt(0), 16_777_619)
  }
  return state || 1
}

const nextNoise = (state: { value: number }): number => {
  let value = state.value
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  state.value = value
  return (value >>> 0) / 2_147_483_648 - 1
}

const writeHeader = (view: DataView, sampleRate: AudioSampleRate, sampleCount: AudioCount): void => {
  const ascii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + sampleCount * 2, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, sampleCount * 2, true)
}

/** Generate one original, dependency-free PCM WAV sample. */
export const generateOriginalSampleWav = (
  soundId: OriginalSampleSoundId,
  options: OriginalSampleBankOptions = {},
): ArrayBuffer => {
  const {
    sampleRate: requestedSampleRate = ORIGINAL_SAMPLE_RATE,
    seed: requestedSeed = 0x4d_43_41,
  } = options
  const validSampleRate = makeAudioSampleRate.option(requestedSampleRate)
  if (Option.isNone(validSampleRate)) {
    throw new TypeError('Original sample rate must be a positive integer')
  }
  const sampleRate = makeAudioSampleRate(
    Math.round(Math.min(48_000, Math.max(8_000, validSampleRate.value))),
  )
  const validSeed = makeAudioSeed.option(requestedSeed)
  if (Option.isNone(validSeed)) {
    throw new TypeError('Original sample seed must be a safe integer')
  }
  const spec = specFor(soundId)
  const sampleCount = makeAudioCount(Math.max(1, Math.round(spec.durationSecs * sampleRate)))
  const buffer = new ArrayBuffer(44 + sampleCount * 2)
  const view = new DataView(buffer)
  const random = { value: hash(soundId, validSeed.value) }
  writeHeader(view, sampleRate, sampleCount)

  let filteredNoise = 0
  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / sampleCount
    const isAmbience = soundId.endsWith('Ambient') || soundId.endsWith('Ambience')
    const envelope = Math.min(1, progress * 35) * ((1 - progress) ** (isAmbience ? 0.35 : 1.7))
    const frequency = spec.frequency * (1 + (spec.sweep - 1) * progress)
    const phase = 2 * Math.PI * frequency * index / sampleRate
    filteredNoise = filteredNoise * 0.72 + nextNoise(random) * 0.28
    const tonal = Math.sin(phase) * 0.7 + Math.sin(phase * 2.01) * 0.18
    const sample = envelope * (tonal * (1 - spec.noise) + filteredNoise * spec.noise) * 0.72
    view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32_767), true)
  }
  return buffer
}

/** A complete built-in manifest accepted directly by `makeWebAudioBackend`. */
export const createOriginalSampleManifest = (
  options: OriginalSampleBankOptions = {},
): AudioSampleManifest => new Map<AudioSampleId, AudioSampleSource>(
  ORIGINAL_SAMPLE_SOUND_IDS.map((soundId) => [
    makeAudioSampleId(soundId),
    { data: generateOriginalSampleWav(soundId, options), kind: 'array-buffer' },
  ] as const),
)

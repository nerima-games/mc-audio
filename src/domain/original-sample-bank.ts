/* oxlint-disable max-statements, no-bitwise, no-magic-numbers, no-nested-ternary, no-ternary, prefer-destructuring -- PCM/WAV synthesis is intentionally numeric and stateful. */
import { CUE_DEFINITIONS, SOUND_CUE_IDS, type SoundCueId } from './cue'
import { END_AUDIO_EVENT_KINDS, END_SOUND_DEFINITIONS, type EndAudioEventKind } from './end-audio'
import type { AudioSampleManifest } from './webaudio-adapter'

export const ORIGINAL_SAMPLE_RATE = 16_000

export const ORIGINAL_SAMPLE_SOUND_IDS = [
  ...SOUND_CUE_IDS,
  ...END_AUDIO_EVENT_KINDS,
  'endAmbience',
] as const

export type OriginalSampleSoundId = (typeof ORIGINAL_SAMPLE_SOUND_IDS)[number]

export type OriginalSampleBankOptions = {
  /** Samples per second. Defaults to 16 kHz; values outside 8-48 kHz are clamped. */
  readonly sampleRate?: number
  /** Changes the generated performance while remaining deterministic. */
  readonly seed?: number
}

type SampleSpec = {
  readonly durationSecs: number
  readonly frequency: number
  readonly noise: number
  readonly sweep: number
}

const endSpec = (id: EndAudioEventKind): SampleSpec => {
  const value = END_SOUND_DEFINITIONS[id]
  return {
    durationSecs: Math.min(value.durationSecs, 1.5),
    frequency: value.fallbackFrequency,
    noise: id.startsWith('dragon') ? 0.52 : 0.18,
    sweep: id === 'portalActivate' || id === 'exitPortal' ? 1.8 : 0.62,
  }
}

const cueSpec = (id: SoundCueId): SampleSpec => {
  const value = CUE_DEFINITIONS[id]
  const noisy = id.startsWith('footstep') || id.startsWith('block') || id.includes('Hurt') || id.includes('Death')
  return {
    durationSecs: value.durationSecs,
    frequency: value.frequency,
    noise: noisy ? 0.6 : id === 'rainAmbient' || id === 'thunderClap' ? 0.75 : 0.12,
    sweep: id === 'thunderClap' ? 0.28 : 1.15,
  }
}

const specFor = (id: OriginalSampleSoundId): SampleSpec => {
  if (id === 'endAmbience') {
    return { durationSecs: 1.5, frequency: 46, noise: 0.16, sweep: 1.04 }
  }
  if ((SOUND_CUE_IDS as ReadonlyArray<string>).includes(id)) {
    return cueSpec(id as SoundCueId)
  }
  return endSpec(id as EndAudioEventKind)
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

const writeHeader = (view: DataView, sampleRate: number, sampleCount: number): void => {
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
  const requestedSampleRate = options.sampleRate ?? ORIGINAL_SAMPLE_RATE
  const sampleRate = Number.isFinite(requestedSampleRate)
    ? Math.round(Math.min(48_000, Math.max(8_000, requestedSampleRate)))
    : ORIGINAL_SAMPLE_RATE
  const spec = specFor(soundId)
  const sampleCount = Math.max(1, Math.round(spec.durationSecs * sampleRate))
  const buffer = new ArrayBuffer(44 + sampleCount * 2)
  const view = new DataView(buffer)
  const random = { value: hash(soundId, options.seed ?? 0x4d_43_41) }
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
): AudioSampleManifest => Object.fromEntries(
  ORIGINAL_SAMPLE_SOUND_IDS.map((soundId) => [
    soundId,
    { data: generateOriginalSampleWav(soundId, options), kind: 'array-buffer' as const },
  ]),
)

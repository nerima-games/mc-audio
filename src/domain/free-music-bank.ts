/* oxlint-disable max-statements, no-bitwise, no-magic-numbers, no-nested-ternary, no-ternary, prefer-destructuring -- PCM/WAV synthesis is intentionally numeric and stateful. */
import {
  FREE_MINECRAFT_MUSIC_EVENT_VARIANTS,
  FREE_MINECRAFT_MUSIC_TRACKS,
  type FreeMusicEventId,
  type FreeMusicTrack,
} from './free-music-data.js'
import type { AudioSampleManifest } from './audio-sample.js'
import type { MinecraftSoundRegistry } from './minecraft-sounds.js'

export {
  FREE_MINECRAFT_MUSIC_EVENT_VARIANTS,
  FREE_MINECRAFT_MUSIC_TRACKS,
} from './free-music-data.js'
export type {
  FreeMusicEventId,
  FreeMusicEventVariant,
  FreeMusicTrack,
} from './free-music-data.js'

export const FREE_MUSIC_SAMPLE_RATE = 22_050
export const FREE_MUSIC_DURATION_SECS = 8
const FREE_MUSIC_MAX_DURATION_SECS = 60

export type FreeMusicBankOptions = {
  /** Samples per second. Defaults to 22.05 kHz; values outside 8-48 kHz are clamped. */
  readonly sampleRate?: number
  /** Track length in seconds. Defaults to eight seconds; values above one minute are rejected. */
  readonly durationSecs?: number
}

export type FreeMinecraftMusicPack = {
  readonly manifest: AudioSampleManifest
  readonly registry: MinecraftSoundRegistry
}

const sampleRateFor = (requestedSampleRate: number | undefined): number => {
  const sampleRate = requestedSampleRate ?? FREE_MUSIC_SAMPLE_RATE
  return Number.isFinite(sampleRate)
    ? Math.round(Math.min(48_000, Math.max(8_000, sampleRate)))
    : FREE_MUSIC_SAMPLE_RATE
}

const durationFor = (requestedDurationSecs: number | undefined): number => {
  const durationSecs = requestedDurationSecs ?? FREE_MUSIC_DURATION_SECS
  if (!Number.isFinite(durationSecs) || durationSecs <= 0) {
    return FREE_MUSIC_DURATION_SECS
  }
  if (durationSecs > FREE_MUSIC_MAX_DURATION_SECS) {
    throw new RangeError(
      `Free Minecraft music duration must be at most ${FREE_MUSIC_MAX_DURATION_SECS} seconds`,
    )
  }
  return durationSecs
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

const renderFreeMusicWav = (
  track: FreeMusicTrack,
  options: FreeMusicBankOptions = {},
): ArrayBuffer => {
  const sampleRate = sampleRateFor(options.sampleRate)
  const durationSecs = durationFor(options.durationSecs)
  const sampleCount = Math.max(1, Math.round(durationSecs * sampleRate))
  const buffer = new ArrayBuffer(44 + sampleCount * 2)
  const view = new DataView(buffer)
  const beatSecs = 60 / track.bpm
  writeHeader(view, sampleRate, sampleCount)

  for (let index = 0; index < sampleCount; index += 1) {
    const timeSecs = index / sampleRate
    const noteIndex = Math.floor(timeSecs / beatSecs) % track.notes.length
    const noteTimeSecs = timeSecs % beatSecs
    const frequency = track.notes[noteIndex]!
    const phase = 2 * Math.PI * frequency * timeSecs
    const attack = Math.min(1, noteTimeSecs * 24)
    const release = Math.min(1, Math.max(0, beatSecs - noteTimeSecs) * 8)
    const envelope = attack * release * Math.min(1, timeSecs * 2) * Math.min(1, (durationSecs - timeSecs) * 2)
    const tone = Math.sin(phase) * 0.62 + Math.sin(phase * 2.01) * 0.16
    const bass = Math.sin(phase * 0.5) * 0.18
    const sample = Math.max(-1, Math.min(1, envelope * (tone + bass) * 0.56))
    view.setInt16(44 + index * 2, Math.round(sample * 32_767), true)
  }
  return buffer
}

/** Generate the original, dependency-free music sample for one built-in track. */
export const generateFreeMusicWav = (
  soundId: string,
  options: FreeMusicBankOptions = {},
): ArrayBuffer => {
  const track = FREE_MINECRAFT_MUSIC_TRACKS.find((candidate) => candidate.soundId === soundId) ?? null
  if (track === null) {
    throw new Error(`Unknown free Minecraft music sound: ${soundId}`)
  }
  return renderFreeMusicWav(track, options)
}

/** A free additive bank with Minecraft-compatible event and sound identifiers. */
export const createFreeMinecraftMusicManifest = (
  options: FreeMusicBankOptions = {},
): AudioSampleManifest => Object.fromEntries(
  FREE_MINECRAFT_MUSIC_TRACKS.map((track) => [
    track.soundId,
    {
      data: renderFreeMusicWav(track, options),
      kind: 'array-buffer' as const,
      preload: true,
      stream: true,
    },
  ]),
)

const FREE_MINECRAFT_MUSIC_EVENT_IDS = Object.keys(
  FREE_MINECRAFT_MUSIC_EVENT_VARIANTS,
) as FreeMusicEventId[]

/** Sound events matching Minecraft's built-in, biome, and music-disc names. */
export const createFreeMinecraftMusicRegistry = (): MinecraftSoundRegistry => ({
  events: Object.fromEntries(
    FREE_MINECRAFT_MUSIC_EVENT_IDS.map((eventId) => [
      eventId,
      {
        id: eventId,
        replace: false,
        sounds: FREE_MINECRAFT_MUSIC_EVENT_VARIANTS[eventId].map((variant) => ({
          attenuationDistance: 16,
          name: variant.soundId,
          pitch: 1,
          preload: true,
          stream: variant.stream,
          type: variant.type,
          volume: variant.volume,
          weight: variant.weight,
        })),
        subtitle: null,
      },
    ]),
  ),
})

export const createFreeMinecraftMusicPack = (
  options: FreeMusicBankOptions = {},
): FreeMinecraftMusicPack => ({
  manifest: createFreeMinecraftMusicManifest(options),
  registry: createFreeMinecraftMusicRegistry(),
})

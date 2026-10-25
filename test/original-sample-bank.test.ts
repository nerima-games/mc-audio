/* oxlint-disable no-magic-numbers, sort-imports -- Assertions validate the binary WAV format offsets and authored seeds. */
import { describe, expect, it } from 'vitest'
import { Option } from 'effect'
import { AudioSampleId, AudioSampleRate, AudioSeed } from '../src/domain/audio-brands'
import { SoundCueId } from '../src/domain/cue'
import {
  END_AUDIO_EVENT_KINDS,
  ORIGINAL_SAMPLE_SOUND_IDS,
  SOUND_CUE_IDS,
  createOriginalSampleManifest,
  generateOriginalSampleWav,
} from '../src/index'

const pcmPeak = (buffer: ArrayBuffer): number => {
  const view = new DataView(buffer)
  let peak = 0
  for (let offset = 44; offset < buffer.byteLength; offset += 2) {
    peak = Math.max(peak, Math.abs(view.getInt16(offset, true)))
  }
  return peak
}

describe('original PCM sample bank', () => {
  const blockBreak = SoundCueId('blockBreak')

  it('covers every gameplay cue and the End/portal sound vocabulary', () => {
    const manifest = createOriginalSampleManifest()
    expect([...manifest.keys()].sort()).toStrictEqual([...ORIGINAL_SAMPLE_SOUND_IDS].map(AudioSampleId).sort())
    expect(SOUND_CUE_IDS.every((id) => manifest.get(AudioSampleId(id))?.kind === 'array-buffer')).toBe(true)
    expect(END_AUDIO_EVENT_KINDS.every((id) => manifest.get(AudioSampleId(id))?.kind === 'array-buffer')).toBe(true)
    expect(manifest.get(AudioSampleId('endAmbience'))?.kind).toBe('array-buffer')
  })

  it.each(ORIGINAL_SAMPLE_SOUND_IDS)('%s is a valid, non-silent PCM WAV', (soundId) => {
    const wav = generateOriginalSampleWav(soundId)
    const view = new DataView(wav)
    expect(String.fromCharCode(...new Uint8Array(wav, 0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...new Uint8Array(wav, 8, 4))).toBe('WAVE')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(wav.byteLength - 44)
    expect(pcmPeak(wav)).toBeGreaterThan(500)
  })

  it('is byte-for-byte deterministic for a seed and varies across seeds', () => {
    const first = new Uint8Array(generateOriginalSampleWav(blockBreak, { seed: AudioSeed(7) }))
    const second = new Uint8Array(generateOriginalSampleWav(blockBreak, { seed: AudioSeed(7) }))
    const other = new Uint8Array(generateOriginalSampleWav(blockBreak, { seed: AudioSeed(8) }))
    expect(first).toStrictEqual(second)
    expect(first).not.toStrictEqual(other)
  })

  it('requires a finite positive sample rate and clamps valid rates to the supported range', () => {
  expect(Option.isNone(AudioSampleRate.option(Number.NaN))).toBe(true)
  expect(Option.isNone(AudioSampleRate.option(Number.POSITIVE_INFINITY))).toBe(true)
  expect(Option.isNone(AudioSampleRate.option(Number.NEGATIVE_INFINITY))).toBe(true)
  const below = generateOriginalSampleWav(blockBreak, { sampleRate: AudioSampleRate(1) })
  const above = generateOriginalSampleWav(blockBreak, { sampleRate: AudioSampleRate(100_000) })
  expect(new DataView(below).getUint32(24, true)).toBe(8_000)
  expect(new DataView(above).getUint32(24, true)).toBe(48_000)
  // @ts-expect-error Simulate an explicit null from an untyped JavaScript caller.
  expect(() => generateOriginalSampleWav(blockBreak, { sampleRate: null })).toThrow(TypeError)
  // @ts-expect-error Simulate an explicit null from an untyped JavaScript caller.
  expect(() => generateOriginalSampleWav(blockBreak, { seed: null })).toThrow(TypeError)
})

  it('never seeds the noise generator with zero, even for a seed chosen to hash to it', () => {
    // The internal hash is `Math.imul(state ^ charCode, 16_777_619)` folded
    // over 'blockBreak', and -498_090_764 is the one seed (of 2^32) whose
    // chain lands on exactly 0 before the `|| 1` fallback — found by
    // inverting the hash arithmetic, not by guessing. A zero-seeded xorshift
    // generator never leaves zero, which would make the sample silent.
    const wav = generateOriginalSampleWav(blockBreak, { seed: AudioSeed(-498_090_764) })
    expect(pcmPeak(wav)).toBeGreaterThan(500)
  })
})

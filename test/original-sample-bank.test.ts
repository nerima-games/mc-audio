/* oxlint-disable no-magic-numbers, sort-imports -- Assertions validate the binary WAV format offsets and authored seeds. */
import { describe, expect, it } from 'vitest'
import { Option, Result } from 'effect'
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
    const manifestResult = createOriginalSampleManifest()
    expect(Result.isSuccess(manifestResult)).toBe(true)
    if (Result.isFailure(manifestResult)) {
      return
    }
    const manifest = manifestResult.success
    expect([...manifest.keys()].sort()).toStrictEqual([...ORIGINAL_SAMPLE_SOUND_IDS].map(AudioSampleId).sort())
    expect(SOUND_CUE_IDS.every((id) => manifest.get(AudioSampleId(id))?.kind === 'array-buffer')).toBe(true)
    expect(END_AUDIO_EVENT_KINDS.every((id) => manifest.get(AudioSampleId(id))?.kind === 'array-buffer')).toBe(true)
    expect(manifest.get(AudioSampleId('endAmbience'))?.kind).toBe('array-buffer')
  })

  it.each(ORIGINAL_SAMPLE_SOUND_IDS)('%s is a valid, non-silent PCM WAV', (soundId) => {
    const wavResult = generateOriginalSampleWav(soundId)
    expect(Result.isSuccess(wavResult)).toBe(true)
    if (Result.isFailure(wavResult)) {
      return
    }
    const wav = wavResult.success
    const view = new DataView(wav)
    expect(String.fromCharCode(...new Uint8Array(wav, 0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...new Uint8Array(wav, 8, 4))).toBe('WAVE')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(wav.byteLength - 44)
    expect(pcmPeak(wav)).toBeGreaterThan(500)
  })

  it('is byte-for-byte deterministic for a seed and varies across seeds', () => {
    const firstResult = generateOriginalSampleWav(blockBreak, { seed: AudioSeed(7) })
    const secondResult = generateOriginalSampleWav(blockBreak, { seed: AudioSeed(7) })
    const otherResult = generateOriginalSampleWav(blockBreak, { seed: AudioSeed(8) })
    expect(Result.isSuccess(firstResult) && Result.isSuccess(secondResult) && Result.isSuccess(otherResult)).toBe(true)
    if (Result.isFailure(firstResult) || Result.isFailure(secondResult) || Result.isFailure(otherResult)) {
      return
    }
    const first = new Uint8Array(firstResult.success)
    const second = new Uint8Array(secondResult.success)
    const other = new Uint8Array(otherResult.success)
    expect(first).toStrictEqual(second)
    expect(first).not.toStrictEqual(other)
  })

  it('requires a finite positive sample rate and clamps valid rates to the supported range', () => {
    expect(Option.isNone(AudioSampleRate.option(Number.NaN))).toBe(true)
    expect(Option.isNone(AudioSampleRate.option(Number.POSITIVE_INFINITY))).toBe(true)
    expect(Option.isNone(AudioSampleRate.option(Number.NEGATIVE_INFINITY))).toBe(true)
    const belowResult = generateOriginalSampleWav(blockBreak, { sampleRate: AudioSampleRate(1) })
    const aboveResult = generateOriginalSampleWav(blockBreak, { sampleRate: AudioSampleRate(100_000) })
    expect(Result.isSuccess(belowResult) && Result.isSuccess(aboveResult)).toBe(true)
    if (Result.isFailure(belowResult) || Result.isFailure(aboveResult)) {
      return
    }
    const below = belowResult.success
    const above = aboveResult.success
    expect(new DataView(below).getUint32(24, true)).toBe(8_000)
    expect(new DataView(above).getUint32(24, true)).toBe(48_000)
    // @ts-expect-error Simulate an explicit null from an untyped JavaScript caller.
    const nullSampleRate = generateOriginalSampleWav(blockBreak, { sampleRate: null })
    expect(Result.isFailure(nullSampleRate)).toBe(true)
    if (Result.isFailure(nullSampleRate)) {
      expect(nullSampleRate.failure.field).toBe('sampleRate')
    }
    // @ts-expect-error Simulate an explicit undefined from an untyped JavaScript caller.
    const undefinedSampleRate = generateOriginalSampleWav(blockBreak, { sampleRate: undefined })
    expect(Result.isFailure(undefinedSampleRate)).toBe(true)
    if (Result.isFailure(undefinedSampleRate)) {
      expect(undefinedSampleRate.failure.field).toBe('sampleRate')
    }
    // @ts-expect-error Simulate a non-finite rate from an untyped JavaScript caller.
    const nonFiniteSampleRate = generateOriginalSampleWav(blockBreak, { sampleRate: Number.NaN })
    expect(Result.isFailure(nonFiniteSampleRate)).toBe(true)
    if (Result.isFailure(nonFiniteSampleRate)) {
      expect(nonFiniteSampleRate.failure.field).toBe('sampleRate')
    }
    // @ts-expect-error Simulate an explicit null from an untyped JavaScript caller.
    const nullSeed = generateOriginalSampleWav(blockBreak, { seed: null })
    expect(Result.isFailure(nullSeed)).toBe(true)
    if (Result.isFailure(nullSeed)) {
      expect(nullSeed.failure.field).toBe('seed')
    }
    // @ts-expect-error Simulate an explicit undefined from an untyped JavaScript caller.
    const undefinedSeed = generateOriginalSampleWav(blockBreak, { seed: undefined })
    expect(Result.isFailure(undefinedSeed)).toBe(true)
    if (Result.isFailure(undefinedSeed)) {
      expect(undefinedSeed.failure.field).toBe('seed')
    }
    // @ts-expect-error Simulate a non-finite seed from an untyped JavaScript caller.
    const nonFiniteSeed = generateOriginalSampleWav(blockBreak, { seed: Number.NaN })
    expect(Result.isFailure(nonFiniteSeed)).toBe(true)
    if (Result.isFailure(nonFiniteSeed)) {
      expect(nonFiniteSeed.failure.field).toBe('seed')
    }
    // @ts-expect-error Simulate a null options object from an untyped JavaScript caller.
    const nullOptions = generateOriginalSampleWav(blockBreak, null)
    expect(Result.isFailure(nullOptions)).toBe(true)
    if (Result.isFailure(nullOptions)) {
      expect(nullOptions.failure.field).toBe('options')
    }
    // @ts-expect-error Simulate a non-object options value from an untyped JavaScript caller.
    const primitiveOptions = generateOriginalSampleWav(blockBreak, 1)
    expect(Result.isFailure(primitiveOptions)).toBe(true)
    if (Result.isFailure(primitiveOptions)) {
      expect(primitiveOptions.failure.field).toBe('options')
    }
    // @ts-expect-error Simulate an unsupported sound id from an untyped JavaScript caller.
    const unknownSound = generateOriginalSampleWav('missing')
    expect(Result.isFailure(unknownSound)).toBe(true)
    if (Result.isFailure(unknownSound)) {
      expect(unknownSound.failure.field).toBe('soundId')
    }
    // @ts-expect-error Simulate an explicit null from an untyped JavaScript caller.
    const nullManifestSeed = createOriginalSampleManifest({ seed: null })
    expect(Result.isFailure(nullManifestSeed)).toBe(true)
    if (Result.isFailure(nullManifestSeed)) {
      expect(nullManifestSeed.failure.field).toBe('seed')
    }
  })

  it('never seeds the noise generator with zero, even for a seed chosen to hash to it', () => {
    // The internal hash is `Math.imul(state ^ charCode, 16_777_619)` folded
    // over 'blockBreak', and -498_090_764 is the one seed (of 2^32) whose
    // chain lands on exactly 0 before the `|| 1` fallback — found by
    // inverting the hash arithmetic, not by guessing. A zero-seeded xorshift
    // generator never leaves zero, which would make the sample silent.
    const wavResult = generateOriginalSampleWav(blockBreak, { seed: AudioSeed(-498_090_764) })
    expect(Result.isSuccess(wavResult)).toBe(true)
    if (Result.isFailure(wavResult)) {
      return
    }
    const wav = wavResult.success
    expect(pcmPeak(wav)).toBeGreaterThan(500)
  })
})

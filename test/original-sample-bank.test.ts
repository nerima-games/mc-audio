/* oxlint-disable no-magic-numbers, sort-imports -- Assertions validate the binary WAV format offsets and authored seeds. */
import { describe, expect, it } from 'vitest'
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
  it('covers every gameplay cue and the End/portal sound vocabulary', () => {
    const manifest = createOriginalSampleManifest()
    expect(Object.keys(manifest).sort()).toStrictEqual([...ORIGINAL_SAMPLE_SOUND_IDS].sort())
    expect(SOUND_CUE_IDS.every((id) => manifest[id]?.kind === 'array-buffer')).toBe(true)
    expect(END_AUDIO_EVENT_KINDS.every((id) => manifest[id]?.kind === 'array-buffer')).toBe(true)
    expect(manifest['endAmbience']?.kind).toBe('array-buffer')
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
    const first = new Uint8Array(generateOriginalSampleWav('blockBreak', { seed: 7 }))
    const second = new Uint8Array(generateOriginalSampleWav('blockBreak', { seed: 7 }))
    const other = new Uint8Array(generateOriginalSampleWav('blockBreak', { seed: 8 }))
    expect(first).toStrictEqual(second)
    expect(first).not.toStrictEqual(other)
  })
})

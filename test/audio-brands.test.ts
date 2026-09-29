import { describe, expect, it } from '@effect/vitest'
import { AUDIO_VOCABULARIES } from './audio-brands.compile'

describe('audio vocabulary boundary', () => {
  it('keeps every public vocabulary non-empty and duplicate-free', () => {
    for (const [name, values] of Object.entries(AUDIO_VOCABULARIES)) {
      expect(values.length, `${name} vocabulary must not be empty`).toBeGreaterThan(0)
      expect(new Set(values).size, `${name} vocabulary must not contain duplicates`).toBe(values.length)
    }
  })
})

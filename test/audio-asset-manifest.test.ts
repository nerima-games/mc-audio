import { Result } from 'effect'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { audioAssetCredits, decodeAudioAssetManifest, decodeAudioAssetVariant } from '../src/domain/audio-asset-manifest.js'

const externalAttribution = {
  author: 'Example artist',
  licenseName: 'CC0 1.0 Universal',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  modified: false,
  sourceUrl: 'https://example.org/audio/block-break.ogg',
  type: 'external',
  workTitle: 'Block break',
} as const

const generatedAttribution = {
  generatorScript: 'scripts/audio/generate-example.ts',
  licenseFile: 'LICENSE',
  licenseName: 'MIT License',
  licenseSpdx: 'MIT',
  licenseUrl: 'https://opensource.org/license/MIT',
  type: 'generated',
} as const

const assetVariant = (overrides: Record<string, unknown> = {}) => ({
  attribution: externalAttribution,
  file: 'audio/block-break.ogg',
  pitchRange: { maximum: 2, minimum: 0.5 },
  volume: 1,
  ...overrides,
})

const expectFailure = (input: unknown): void => {
  const result = decodeAudioAssetManifest(input)
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) {
    expect(result.failure).toMatchObject({ _tag: 'AudioAssetManifestFailure' })
  }
}

describe('audio asset manifest', () => {
  it('decodes cue variants with external and generated attribution', () => {
    const result = decodeAudioAssetManifest({
      blockBreak: [assetVariant(), assetVariant({ file: 'audio/block-break-alt.ogg' })],
      blockPlace: [assetVariant({
        attribution: generatedAttribution,
        file: 'audio/generated-place.ogg',
        surface: 'wood',
      })],
    })

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success['blockBreak']?.[0]?.attribution).toEqual(externalAttribution)
      expect(result.success['blockBreak']?.[0]?.surface).toBeUndefined()
      expect(result.success['blockPlace']?.[0]?.attribution).toEqual(generatedAttribution)
      expect(audioAssetCredits(result.success)).toEqual([externalAttribution, generatedAttribution])
    }
  })

  it('decodes one asset variant without throwing for arbitrary input', () => {
    expect(Result.isSuccess(decodeAudioAssetVariant(assetVariant()))).toBe(true)
    expect(Result.isFailure(decodeAudioAssetVariant(assetVariant({ file: '../outside.ogg' })))).toBe(true)
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const result = decodeAudioAssetVariant(input)
        return Result.isSuccess(result) || Result.isFailure(result)
      }),
      { numRuns: 500 },
    )
    const uninspectable = new Proxy({}, {
      ownKeys: () => {
        throw new Error('cannot enumerate asset variant')
      },
    })
    expect(() => decodeAudioAssetVariant(uninspectable)).not.toThrow()
    expect(Result.isFailure(decodeAudioAssetVariant(uninspectable))).toBe(true)
  })

  it('accepts an empty manifest for procedural-only playback', () => {
    expect(decodeAudioAssetManifest({})).toEqual(Result.succeed({}))
    expect(audioAssetCredits({ unknownCue: undefined })).toEqual([])
  })

  it('rejects unknown cues and missing required fields', () => {
    expectFailure({ madeUpCue: [assetVariant()] })
    expectFailure({ blockBreak: [{}] })
    expectFailure({ blockBreak: [{ ...assetVariant(), attribution: undefined }] })
    expectFailure({ blockBreak: [{ attribution: externalAttribution, file: 'audio/a.ogg', volume: 1 }] })
    expectFailure({ blockBreak: [{ attribution: externalAttribution, pitchRange: { minimum: 1, maximum: 1 }, volume: 1 }] })
    expectFailure({ blockBreak: [] })
  })

  it('keeps generated attribution local and validates generator and license paths', () => {
    expectFailure({ blockBreak: [assetVariant({
      attribution: { ...generatedAttribution, sourceUrl: 'https://example.org/not-generated' },
    })] })
    expectFailure({ blockBreak: [assetVariant({
      attribution: { ...generatedAttribution, generatorScript: '../generate.ts' },
    })] })
    expectFailure({ blockBreak: [assetVariant({
      attribution: { ...generatedAttribution, licenseFile: '/LICENSE' },
    })] })
    expectFailure({ blockBreak: [assetVariant({
      attribution: { ...generatedAttribution, licenseSpdx: 'MIT License' },
    })] })
    expectFailure({ blockBreak: [assetVariant({ attribution: { ...externalAttribution, author: '  ' } })] })
    expectFailure({ blockBreak: [assetVariant({ attribution: { ...externalAttribution, workTitle: '\t' } })] })
    expectFailure({ blockBreak: [assetVariant({ attribution: { ...externalAttribution, licenseName: '' } })] })
  })

  it('rejects empty, absolute, traversing, encoded, and malformed relative paths', () => {
    for (const file of ['', '/audio/a.ogg', '../audio/a.ogg', 'audio/../a.ogg', 'audio//a.ogg', 'audio/%2e%2e/a.ogg', 'audio%zz.ogg', 'C:/audio/a.ogg']) {
      expectFailure({ blockBreak: [assetVariant({ file })] })
    }
  })

  it('rejects malformed, non-HTTP, and credential-bearing attribution URLs', () => {
    for (const sourceUrl of [
      'not a URL',
      'ftp://example.org/work',
      'https://user:secret@example.org/work',
      'https://:80/work',
      `https://${'a'.repeat(254)}/work`,
      'https://256.1.1.1/work',
      'https://-bad.example/work',
      'https://[gg::1]/work',
      'https://[1::2::3]/work',
      'https://[12345::1]/work',
      'https://[1:2:3:4:5:6:7]/work',
      'https://[1:2:3:4:5:6:7:8::]/work',
      'https://[::1]suffix/work',
      'https://[::1]:abc/work',
      'https://example.org:80:90/work',
      'https://example.org:65536/work',
      'https://example.org:/work',
      'https://[2001:db8::1/work',
      'https://example.org/%zz',
      'https://example.org/a b',
      'https://example.org/a\u0001b',
    ]) {
      expectFailure({ blockBreak: [assetVariant({ attribution: { ...externalAttribution, sourceUrl } })] })
    }
    for (const licenseUrl of ['://bad', 'file:///license']) {
      expectFailure({ blockBreak: [assetVariant({ attribution: { ...externalAttribution, licenseUrl } })] })
    }
    const validIpv6Url = decodeAudioAssetManifest({
      blockBreak: [assetVariant({
        attribution: { ...externalAttribution, sourceUrl: 'https://[2001:db8::1]:65535/work' },
      })],
    })
    expect(Result.isSuccess(validIpv6Url)).toBe(true)

    for (const sourceUrl of [
      'http://example.org/work',
      'https://example.org./work',
      'https://1a.2b.3c.4d/work',
      'https://127.0.0.1/work',
      'https://[::1]/work',
      'https://[1:2:3:4:5:6:7:8]/work',
    ]) {
      expect(Result.isSuccess(decodeAudioAssetManifest({
        blockBreak: [assetVariant({ attribution: { ...externalAttribution, sourceUrl } })],
      }))).toBe(true)
    }
  })

  it('enforces AudioVolume bounds and the documented finite pitch range', () => {
    for (const volume of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectFailure({ blockBreak: [assetVariant({ volume })] })
    }
    expectFailure({ blockBreak: [assetVariant({ pitchRange: { minimum: 0.49, maximum: 1 } })] })
    expectFailure({ blockBreak: [assetVariant({ pitchRange: { minimum: 1, maximum: 2.01 } })] })
    expectFailure({ blockBreak: [assetVariant({ pitchRange: { minimum: 1.5, maximum: 1 } })] })

    const boundary = decodeAudioAssetManifest({
      blockBreak: [assetVariant({ pitchRange: { minimum: 0.5, maximum: 2 }, volume: 0 })],
      blockPlace: [assetVariant({ pitchRange: { minimum: 1, maximum: 1 }, volume: 1 })],
    })
    expect(Result.isSuccess(boundary)).toBe(true)
  })

  it('returns a typed Result without throwing for arbitrary input', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const result = decodeAudioAssetManifest(input)
        return Result.isSuccess(result) || Result.isFailure(result)
      }),
      { numRuns: 500 },
    )
    expect(() => decodeAudioAssetManifest(new Proxy({}, {
      ownKeys: () => {
        throw new Error('cannot enumerate manifest')
      },
    }))).not.toThrow()
    expectFailure(new Proxy({}, {
      ownKeys: () => {
        throw new Error('cannot enumerate manifest')
      },
    }))
  })
})

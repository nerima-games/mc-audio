import { describe, expect, it } from 'vitest'
import { Result } from 'effect'
import { AudioSampleId, AudioSampleUrl } from '../src/domain/audio-brands.js'
import {
  mergeAudioSampleManifests,
  parseAudioSampleManifest,
  type AudioSampleSource,
} from '../src/domain/audio-sample.js'

const expectManifestFailureAt = (input: unknown, path: string): void => {
  const result = parseAudioSampleManifest(input)
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) {
    expect(result.failure).toMatchObject({
      _tag: 'AudioSampleManifestFailure',
      path,
    })
  }
}

describe('audio sample manifest', () => {
  it('parses array buffers and URLs while preserving omitted and explicit flags', () => {
    const data = new ArrayBuffer(8)
    const result = parseAudioSampleManifest({
      'buffer/default': { kind: 'array-buffer', data },
      'buffer/flags': { kind: 'array-buffer', data, preload: true, stream: false },
      'url/flags': { kind: 'url', url: '/samples/rain.ogg', preload: false, stream: true },
    })

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success).toStrictEqual(new Map([
        [AudioSampleId('buffer/default'), { kind: 'array-buffer', data }],
        [AudioSampleId('buffer/flags'), { kind: 'array-buffer', data, preload: true, stream: false }],
        [AudioSampleId('url/flags'), {
          kind: 'url',
          url: AudioSampleUrl('/samples/rain.ogg'),
          preload: false,
          stream: true,
        }],
      ]))
    }
  })

  it('lets the base manifest override duplicate additions and retains unique entries', () => {
    const sharedId = AudioSampleId('shared')
    const baseSource = { kind: 'url' as const, url: AudioSampleUrl('/base.ogg') }
    const addedSource = { kind: 'array-buffer' as const, data: new ArrayBuffer(2) }
    const base = new Map<AudioSampleId, AudioSampleSource>([
      [sharedId, baseSource],
      [AudioSampleId('base-only'), { kind: 'array-buffer' as const, data: new ArrayBuffer(4) }],
    ])
    const additions = new Map<AudioSampleId, AudioSampleSource>([
      [sharedId, addedSource],
      [AudioSampleId('added-only'), { kind: 'url' as const, url: AudioSampleUrl('/added.ogg') }],
    ])

    const merged = mergeAudioSampleManifests(base, additions)

    expect(merged).toStrictEqual(new Map([
      [sharedId, baseSource],
      [AudioSampleId('added-only'), { kind: 'url', url: AudioSampleUrl('/added.ogg') }],
      [AudioSampleId('base-only'), { kind: 'array-buffer', data: new ArrayBuffer(4) }],
    ]))
    expect(additions.get(sharedId)).toBe(addedSource)
    expect(base.get(sharedId)).toBe(baseSource)
  })

  it('reports the manifest path for non-object inputs', () => {
    for (const input of [null, [], 'manifest']) {
      expectManifestFailureAt(input, '$')
    }
  })

  it('reports the sample id when a key fails brand validation', () => {
    expectManifestFailureAt({ '': { kind: 'url', url: '/sample.ogg' } }, '')
  })

  it('reports malformed entries and invalid optional flags at their exact paths', () => {
    const data = new ArrayBuffer(1)
    expectManifestFailureAt({ sample: null }, 'sample')
    expectManifestFailureAt({ sample: { kind: 'array-buffer', data, preload: 'yes' } }, 'sample.preload')
    expectManifestFailureAt({ sample: { kind: 'array-buffer', data, stream: 1 } }, 'sample.stream')
  })

  it('reports each invalid source kind payload at its exact path', () => {
    expectManifestFailureAt({ sample: { kind: 'array-buffer', data: new Uint8Array(1) } }, 'sample.data')
    expectManifestFailureAt({ sample: { kind: 'url', url: 1 } }, 'sample.url')
    expectManifestFailureAt({ sample: { kind: 'url', url: '' } }, 'sample.url')
    expectManifestFailureAt({ sample: { kind: 'unknown' } }, 'sample.kind')
  })
})

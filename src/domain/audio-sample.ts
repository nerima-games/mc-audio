/** Host-neutral sample data exchanged by resource loaders and audio backends. */
import { AudioCount, AudioSampleId, AudioSampleUrl } from './audio-brands.js'
import { Result } from 'effect'

export type AudioSampleSource =
  | {
      readonly kind: 'array-buffer'
      readonly data: ArrayBuffer
      readonly preload?: boolean
      readonly stream?: boolean
    }
  | {
      readonly kind: 'url'
      readonly preload?: boolean
      readonly stream?: boolean
      readonly url: AudioSampleUrl
    }

export type AudioSampleManifest = ReadonlyMap<AudioSampleId, AudioSampleSource>

export const mergeAudioSampleManifests = (
  base: AudioSampleManifest,
  additions: AudioSampleManifest,
): AudioSampleManifest => {
  const merged = new Map(additions)
  for (const [id, source] of base) {
    merged.set(id, source)
  }
  return merged
}

export type AudioSampleLoadReport = {
  readonly requested: AudioCount
  readonly loaded: AudioCount
  readonly cached: AudioCount
  readonly failed: AudioCount
}


export type AudioSampleManifestFailure = {
  readonly _tag: 'AudioSampleManifestFailure'
  readonly path: string
  readonly message: string
}

const manifestFailure = (path: string, message: string): Result.Result<never, AudioSampleManifestFailure> =>
  Result.fail({ _tag: 'AudioSampleManifestFailure', message, path })

type AudioSampleFlags = {
  readonly preload?: boolean
  readonly stream?: boolean
}

type OptionalBoolean =
  | { readonly present: false }
  | { readonly present: true; readonly value: boolean }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const optionalBoolean = (
  source: Record<string, unknown>,
  key: 'preload' | 'stream',
  path: string,
): Result.Result<OptionalBoolean, AudioSampleManifestFailure> => {
  if (!Object.hasOwn(source, key)) {
    return Result.succeed({ present: false })
  }
  const value = source[key]
  if (typeof value !== 'boolean') {
    return manifestFailure(`${path}.${key}`, `Audio sample ${key} must be a boolean`)
  }
  return Result.succeed({ present: true, value })
}

const sampleFlagsFromResults = (
  preload: OptionalBoolean,
  stream: Result.Result<OptionalBoolean, AudioSampleManifestFailure>,
): Result.Result<AudioSampleFlags, AudioSampleManifestFailure> => {
  if (Result.isFailure(stream)) {
    return Result.fail(stream.failure)
  }
  const flags: { preload?: boolean; stream?: boolean } = {}
  if (preload.present) {
    flags.preload = preload.value
  }
  if (stream.success.present) {
    flags.stream = stream.success.value
  }
  return Result.succeed(flags)
}

const sampleFlagsFromJson = (
  source: Record<string, unknown>,
  path: string,
): Result.Result<AudioSampleFlags, AudioSampleManifestFailure> => {
  const preload = optionalBoolean(source, 'preload', path)
  if (Result.isFailure(preload)) {
    return Result.fail(preload.failure)
  }
  const stream = optionalBoolean(source, 'stream', path)
  return sampleFlagsFromResults(preload.success, stream)
}

const arrayBufferSourceFromJson = (
  source: Record<string, unknown>,
  flags: AudioSampleFlags,
  path: string,
): Result.Result<AudioSampleSource, AudioSampleManifestFailure> => {
  const { data } = source
  if (!(data instanceof ArrayBuffer)) {
    return manifestFailure(`${path}.data`, 'Audio sample data must be an ArrayBuffer')
  }
  return Result.succeed({ ...flags, data, kind: 'array-buffer' })
}

const urlSourceFromJson = (
  source: Record<string, unknown>,
  flags: AudioSampleFlags,
  path: string,
): Result.Result<AudioSampleSource, AudioSampleManifestFailure> => {
  const { url: rawUrl } = source
  if (typeof rawUrl !== 'string') {
    return manifestFailure(`${path}.url`, 'Audio sample URL must be a string')
  }
  const url = AudioSampleUrl.result(rawUrl)
  if (Result.isFailure(url)) {
    return manifestFailure(`${path}.url`, url.failure.message)
  }
  return Result.succeed({ ...flags, kind: 'url', url: url.success })
}

const sampleSourceForKind = (input: {
  readonly kind: unknown
  readonly source: Record<string, unknown>
  readonly flags: AudioSampleFlags
  readonly path: string
}): Result.Result<AudioSampleSource, AudioSampleManifestFailure> => {
  if (input.kind === 'array-buffer') {
    return arrayBufferSourceFromJson(input.source, input.flags, input.path)
  }
  if (input.kind === 'url') {
    return urlSourceFromJson(input.source, input.flags, input.path)
  }
  return manifestFailure(`${input.path}.kind`, 'Audio sample kind must be array-buffer or url')
}

const sampleSourceFromJson = (
  value: unknown,
  path: string,
): Result.Result<AudioSampleSource, AudioSampleManifestFailure> => {
  if (!isRecord(value)) {
    return manifestFailure(path, 'Audio sample source must be an object')
  }

  const source = value
  const { kind } = source
  const flags = sampleFlagsFromJson(source, path)
  if (Result.isFailure(flags)) {
    return Result.fail(flags.failure)
  }
  return sampleSourceForKind({ flags: flags.success, kind, path, source })
}

type ParsedAudioSampleEntry = readonly [AudioSampleId, AudioSampleSource]

const parseAudioSampleEntry = (
  rawId: string,
  rawSource: unknown,
): Result.Result<ParsedAudioSampleEntry, AudioSampleManifestFailure> => {
  const id = AudioSampleId.result(rawId)
  if (Result.isFailure(id)) {
    return manifestFailure(rawId, id.failure.message)
  }
  const source = sampleSourceFromJson(rawSource, rawId)
  if (Result.isFailure(source)) {
    return Result.fail(source.failure)
  }
  return Result.succeed([id.success, source.success])
}

export const parseAudioSampleManifest = (
  input: unknown,
): Result.Result<AudioSampleManifest, AudioSampleManifestFailure> => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return manifestFailure('$', 'Audio sample manifest must be an object')
  }
  const manifest = new Map<AudioSampleId, AudioSampleSource>()
  for (const [rawId, rawSource] of Object.entries(input)) {
    const entry = parseAudioSampleEntry(rawId, rawSource)
    if (Result.isFailure(entry)) {
      return Result.fail(entry.failure)
    }
    manifest.set(...entry.success)
  }
  return Result.succeed(manifest)
}


/* oxlint-disable new-cap -- Effect Schema constructors intentionally use PascalCase factory APIs. */
import {
  type AudioDiagnosticMessage,
  type AudioDiagnosticPath,
  type AudioPlaybackRate,
  type AudioVolume,
  AudioDiagnosticMessage as makeAudioDiagnosticMessage,
  AudioDiagnosticPath as makeAudioDiagnosticPath,
} from './audio-brands.js'
import { Brand, Result, Schema } from 'effect'
import { FOOTSTEP_SURFACES, type FootstepSurface } from './footstep.js'
import { type SoundCueId, isSoundCueId } from './cue.js'

const EMPTY_LENGTH = 0
const FIRST_CHARACTER_OFFSET = 1
const LAST_CHARACTER_OFFSET = -1
const IPV4_PART_COUNT = 4
const IPV4_MAXIMUM_OCTET = 255
const IPV6_COMPRESSION_PART_COUNT = 2
const IPV6_GROUP_COUNT = 8
const MAXIMUM_DOMAIN_LABEL_LENGTH = 63
const MAXIMUM_DOMAIN_NAME_LENGTH = 253
const MAXIMUM_PORT = 65_535
const MINIMUM_PITCH = 0.5
const MAXIMUM_PITCH = 2
const MINIMUM_VOLUME = 0
const MAXIMUM_VOLUME = 1

const nonEmptyText = (value: string): boolean => value.trim().length > EMPTY_LENGTH
const hasControlCharacters = (value: string): boolean => /\p{Cc}/u.test(value)

const isRelativeAudioPath = (value: string): boolean => {
  const segments = value.split('/')
  return value.length > EMPTY_LENGTH &&
    !value.startsWith('/') &&
    !/^[a-z][a-z\d+.-]*:/iu.test(value) &&
    !value.includes('\\') &&
    !value.includes('?') &&
    !value.includes('#') &&
    !/%(?:2e|2f|5c|25)/iu.test(value) &&
    !/%(?![a-f\d]{2})/iu.test(value) &&
    !hasControlCharacters(value) &&
    segments.every((segment) => segment.length > EMPTY_LENGTH && segment !== '.' && segment !== '..')
}

const isValidPort = (value: string): boolean => {
  if (!/^\d{1,5}$/u.test(value)) {
    return false
  }
  return Number(value) <= MAXIMUM_PORT
}

const isValidDomainHost = (host: string): boolean => {
  if (host.length === EMPTY_LENGTH || host.length > MAXIMUM_DOMAIN_NAME_LENGTH) {
    return false
  }
  let hostname = host
  if (hostname.endsWith('.')) {
    hostname = hostname.slice(EMPTY_LENGTH, LAST_CHARACTER_OFFSET)
  }
  const labels = hostname.split('.')
  if (labels.length === IPV4_PART_COUNT && labels.every((label) => /^\d+$/u.test(label))) {
    return labels.every((label) => Number(label) <= IPV4_MAXIMUM_OCTET)
  }
  return labels.every((label) =>
    label.length > EMPTY_LENGTH &&
    label.length <= MAXIMUM_DOMAIN_LABEL_LENGTH &&
    /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/iu.test(label),
  )
}

const parseIpv6Host = (host: string): { readonly compressed: boolean; readonly groups: ReadonlyArray<string> } | null => {
  if (!/^[a-f\d:]+$/iu.test(host) || !host.includes(':')) {
    return null
  }
  const halves = host.split('::')
  if (halves.length > IPV6_COMPRESSION_PART_COUNT) {
    return null
  }
  const groups = halves.flatMap((half) => {
    if (half.length === EMPTY_LENGTH) {
      return []
    }
    return half.split(':')
  })
  if (!groups.every((group) => /^[a-f\d]{1,4}$/iu.test(group))) {
    return null
  }
  return {
    compressed: halves.length === IPV6_COMPRESSION_PART_COUNT,
    groups,
  }
}

const isValidIpv6Host = (host: string): boolean => {
  const parsed = parseIpv6Host(host)
  if (parsed === null) {
    return false
  }
  if (parsed.compressed) {
    return parsed.groups.length < IPV6_GROUP_COUNT
  }
  return parsed.groups.length === IPV6_GROUP_COUNT
}

const isValidIpv6Authority = (authority: string): boolean => {
  const closingBracket = authority.indexOf(']')
  if (closingBracket < EMPTY_LENGTH || !isValidIpv6Host(authority.slice(FIRST_CHARACTER_OFFSET, closingBracket))) {
    return false
  }
  const suffix = authority.slice(closingBracket + FIRST_CHARACTER_OFFSET)
  if (suffix.length === EMPTY_LENGTH) {
    return true
  }
  if (!suffix.startsWith(':')) {
    return false
  }
  return isValidPort(suffix.slice(FIRST_CHARACTER_OFFSET))
}

const splitDomainAuthority = (authority: string): { readonly host: string; readonly port: string | null } | null => {
  const colonIndex = authority.lastIndexOf(':')
  if (colonIndex >= EMPTY_LENGTH && authority.indexOf(':') !== colonIndex) {
    return null
  }
  if (colonIndex < EMPTY_LENGTH) {
    return { host: authority, port: null }
  }
  return {
    host: authority.slice(EMPTY_LENGTH, colonIndex),
    port: authority.slice(colonIndex + FIRST_CHARACTER_OFFSET),
  }
}

const isValidDomainAuthority = (authority: string): boolean => {
  const parsed = splitDomainAuthority(authority)
  if (parsed === null || !isValidDomainHost(parsed.host)) {
    return false
  }
  return parsed.port === null || isValidPort(parsed.port)
}

const isValidAuthority = (authority: string): boolean => {
  if (authority.length === EMPTY_LENGTH || authority.includes('@')) {
    return false
  }
  if (authority.startsWith('[')) {
    return isValidIpv6Authority(authority)
  }
  return isValidDomainAuthority(authority)
}

const isHttpUrl = (value: string): boolean => {
  if (/[\\\s]/u.test(value) || hasControlCharacters(value) || /%(?![a-f\d]{2})/iu.test(value)) {
    return false
  }
  const match = /^(?<protocol>http|https):\/\/(?<authority>[^/?#]+)(?:[/?#][^\s]*)?$/iu.exec(value)
  const authority = match?.groups?.['authority'] ?? null
  return authority !== null && isValidAuthority(authority)
}

export type AudioAssetPath = string & Brand.Brand<'AudioAssetPath'>
export const AudioAssetPathSchema: AudioAssetSchema<AudioAssetPath> = Schema.String
  .check(Schema.makeFilter((value) => isRelativeAudioPath(value) || 'Audio asset path must be a safe relative path'))
  .pipe(Schema.brand('AudioAssetPath'))

export type AudioAssetAuthor = string & Brand.Brand<'AudioAssetAuthor'>
export type AudioAssetWorkTitle = string & Brand.Brand<'AudioAssetWorkTitle'>
export type AudioAssetLicenseName = string & Brand.Brand<'AudioAssetLicenseName'>
export type AudioAssetLicenseSpdx = string & Brand.Brand<'AudioAssetLicenseSpdx'>
export type AudioAssetUrl = string & Brand.Brand<'AudioAssetUrl'>
export type AudioAssetPitchRange = { readonly minimum: AudioPlaybackRate; readonly maximum: AudioPlaybackRate }
export type AudioAssetVolume = AudioVolume

export type AudioAssetExternalAttribution = {
  readonly author: AudioAssetAuthor
  readonly licenseName: AudioAssetLicenseName
  readonly licenseUrl: AudioAssetUrl
  readonly modified: boolean
  readonly sourceUrl: AudioAssetUrl
  readonly type: 'external'
  readonly workTitle: AudioAssetWorkTitle
}

export type AudioAssetGeneratedAttribution = {
  readonly generatorScript: AudioAssetPath
  readonly licenseFile: AudioAssetPath
  readonly licenseName: AudioAssetLicenseName
  readonly licenseSpdx: AudioAssetLicenseSpdx
  readonly licenseUrl: AudioAssetUrl
  readonly type: 'generated'
}

export type AudioAssetAttribution = AudioAssetExternalAttribution | AudioAssetGeneratedAttribution
type AudioAssetSchema<DecodedAsset> = Schema.Codec<DecodedAsset, unknown, never, never>
export type CueAudioAssetVariant = {
  readonly attribution: AudioAssetAttribution
  readonly file: AudioAssetPath
  readonly pitchRange: AudioAssetPitchRange
  readonly surface?: FootstepSurface | undefined
  readonly volume: AudioAssetVolume
}
export type AudioAssetManifest = Readonly<
  Partial<Record<SoundCueId, ReadonlyArray<CueAudioAssetVariant>>> &
  Record<string, ReadonlyArray<CueAudioAssetVariant> | undefined>
>

const nonEmptyTextSchema = Schema.String
  .check(Schema.makeFilter((value) => nonEmptyText(value) || 'Text must not be empty'))

const authorSchema: AudioAssetSchema<AudioAssetAuthor> = nonEmptyTextSchema
  .pipe(Schema.brand('AudioAssetAuthor'))

const workTitleSchema: AudioAssetSchema<AudioAssetWorkTitle> = nonEmptyTextSchema
  .pipe(Schema.brand('AudioAssetWorkTitle'))

const licenseNameSchema: AudioAssetSchema<AudioAssetLicenseName> = nonEmptyTextSchema
  .pipe(Schema.brand('AudioAssetLicenseName'))

const httpUrlSchema: AudioAssetSchema<AudioAssetUrl> = Schema.String
  .check(Schema.makeFilter((value) => isHttpUrl(value) || 'URL must use http or https'))
  .pipe(Schema.brand('AudioAssetUrl'))

const volumeSchema: AudioAssetSchema<AudioAssetVolume> = Schema.Finite
  .check(Schema.isBetween({ maximum: MAXIMUM_VOLUME, minimum: MINIMUM_VOLUME }))
  .pipe(Schema.brand('AudioVolume'))

const pitchSchema: AudioAssetSchema<AudioPlaybackRate> = Schema.Finite
  .check(Schema.isBetween({ maximum: MAXIMUM_PITCH, minimum: MINIMUM_PITCH }))
  .pipe(Schema.brand('AudioPlaybackRate'))

const pitchRangeSchema: AudioAssetSchema<AudioAssetPitchRange> = Schema.Struct({
  maximum: pitchSchema,
  minimum: pitchSchema,
}).check(Schema.makeFilter(({ maximum, minimum }) => minimum <= maximum || 'Pitch range minimum must not exceed maximum'))

const externalAttributionSchema: AudioAssetSchema<AudioAssetExternalAttribution> = Schema.Struct({
  author: authorSchema,
  licenseName: licenseNameSchema,
  licenseUrl: httpUrlSchema,
  modified: Schema.Boolean,
  sourceUrl: httpUrlSchema,
  type: Schema.Literal('external'),
  workTitle: workTitleSchema,
})

const licenseSpdxSchema: AudioAssetSchema<AudioAssetLicenseSpdx> = Schema.String
  .check(Schema.makeFilter((value) => /^[a-z\d][a-z\d.+-]*$/iu.test(value) || 'SPDX license id is invalid'))
  .pipe(Schema.brand('AudioAssetLicenseSpdx'))

const generatedAttributionSchema: AudioAssetSchema<AudioAssetGeneratedAttribution> = Schema.Struct({
  generatorScript: AudioAssetPathSchema,
  licenseFile: AudioAssetPathSchema,
  licenseName: licenseNameSchema,
  licenseSpdx: licenseSpdxSchema,
  licenseUrl: httpUrlSchema,
  type: Schema.Literal('generated'),
})

const attributionSchema: AudioAssetSchema<AudioAssetAttribution> = Schema.Union([externalAttributionSchema, generatedAttributionSchema])

const assetVariantSchema: AudioAssetSchema<CueAudioAssetVariant> = Schema.Struct({
  attribution: attributionSchema,
  file: AudioAssetPathSchema,
  pitchRange: pitchRangeSchema,
  surface: Schema.optional(Schema.Literals(FOOTSTEP_SURFACES)),
  volume: volumeSchema,
})

const cueIdSchema = Schema.String
  .check(Schema.makeFilter((value) => isSoundCueId(value) || 'Unknown sound cue id'))

const variantsSchema: AudioAssetSchema<ReadonlyArray<CueAudioAssetVariant>> = Schema.Array(assetVariantSchema)
  .check(Schema.makeFilter((variants) => variants.length > EMPTY_LENGTH || 'Each cue requires at least one asset variant'))

/** Strict manifest schema keyed by registered audio cues. An empty manifest keeps procedural playback available. */
export const AudioAssetManifestSchema: AudioAssetSchema<AudioAssetManifest> = Schema.Record(cueIdSchema, variantsSchema)

export type AudioAssetManifestFailure = {
  readonly _tag: 'AudioAssetManifestFailure'
  readonly path: AudioDiagnosticPath
  readonly message: AudioDiagnosticMessage
}

const manifestFailure = (message: string): Result.Result<never, AudioAssetManifestFailure> =>
  Result.fail({
    _tag: 'AudioAssetManifestFailure',
    message: makeAudioDiagnosticMessage(message),
    path: makeAudioDiagnosticPath('$'),
  })

/** Decode unknown manifest input without throwing. Extra cue keys are errors. */
export const decodeAudioAssetManifest = (
  input: unknown,
): Result.Result<AudioAssetManifest, AudioAssetManifestFailure> =>
  Result.match(
    Result.try({
      catch: () => 'Audio asset manifest could not be decoded',
      try: () => Schema.decodeUnknownResult(AudioAssetManifestSchema)(input, { onExcessProperty: 'error' }),
    }),
    {
      onFailure: (message) => manifestFailure(message),
      onSuccess: (decoded) => {
        if (Result.isFailure(decoded)) {
          return manifestFailure(decoded.failure.message)
        }
        return Result.succeed(decoded.success)
      },
    },
  )

export type AudioAssetCredit = AudioAssetAttribution

const creditFields = (credit: AudioAssetCredit): ReadonlyArray<string> => {
  if (credit.type === 'external') {
    return ['external', credit.author, credit.workTitle, credit.sourceUrl, credit.licenseName, credit.licenseUrl, String(credit.modified)]
  }
  return ['generated', credit.generatorScript, credit.licenseSpdx, credit.licenseName, credit.licenseFile, credit.licenseUrl]
}

const creditKey = (credit: AudioAssetCredit): string =>
  creditFields(credit).map((field) => `${field.length}:${field}`).join('')

/** Return distinct attribution rows suitable for in-game and distribution credits. */
export const audioAssetCredits = (manifest: AudioAssetManifest): ReadonlyArray<AudioAssetCredit> => {
  const credits = new Map<string, AudioAssetCredit>()
  for (const variants of Object.values(manifest)) {
    if (variants) {
      for (const variant of variants) {
        const credit = variant.attribution
        credits.set(creditKey(credit), credit)
      }
    }
  }
  return [...credits.values()]
}

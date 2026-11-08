import {
  type AudioAssetAttribution,
  type AudioAssetPath,
  decodeAudioAssetVariant,
} from './audio-asset-manifest.js'
import {
  type AudioDelayTicks as AudioDelayTicksType,
  type AudioDiagnosticMessage,
  type AudioDiagnosticPath,
  type AudioSampleId as AudioSampleIdType,
  type MinecraftSoundEventId as MinecraftSoundEventIdType,
  AudioDelayTicks as makeAudioDelayTicks,
  AudioDiagnosticMessage as makeAudioDiagnosticMessage,
  AudioDiagnosticPath as makeAudioDiagnosticPath,
  AudioDistance as makeAudioDistance,
  AudioGain as makeAudioGain,
  AudioPlaybackRate as makeAudioPlaybackRate,
  AudioSampleId as makeAudioSampleId,
  AudioSampleUrl as makeAudioSampleUrl,
  AudioWeight as makeAudioWeight,
  MinecraftSoundEventId as makeMinecraftSoundEventId,
  MinecraftSoundResourceId as makeMinecraftSoundResourceId,
} from './audio-brands.js'
import type { AudioSampleManifest, AudioSampleSource } from './audio-sample.js'
import type { MinecraftSoundEvent, MinecraftSoundRegistry } from './minecraft-sounds-types.js'
import type { MinecraftMusicDefinition } from './minecraft-music-data.js'
import { Result } from 'effect'

const EMPTY_LENGTH = 0
const FIRST_INDEX = 0
const ONE_TICK = 1
const UNITY = 1
const MAX_SILENCE_TICKS = 24_000
const MAX_CROSSFADE_TICKS = 200
const RANDOM_UPPER_BOUND = UNITY - Number.EPSILON
const MUSIC_DISTANCE = 16
const MUSIC_EVENT_PREFIX = 'mc-audio:music/'

export const MINECRAFT_MUSIC_SCENES = [
  'title',
  'day',
  'night',
  'cave',
  'nether',
  'end',
  'combat',
  'underwater',
  'creative',
] as const

export type MinecraftMusicScene = (typeof MINECRAFT_MUSIC_SCENES)[number]

export type MinecraftMusicSceneTrack = {
  readonly attribution: AudioAssetAttribution
  readonly eventId: MinecraftSoundEventIdType
  readonly file: AudioAssetPath
}

export type MinecraftMusicScenePlaylist = {
  readonly crossfadeTicks: AudioDelayTicksType
  readonly maximumSilenceTicks: AudioDelayTicksType
  readonly minimumSilenceTicks: AudioDelayTicksType
  readonly tracks: ReadonlyArray<MinecraftMusicSceneTrack>
}

export type MinecraftMusicScenePlaylistManifest = Readonly<
  Partial<Record<MinecraftMusicScene, MinecraftMusicScenePlaylist>> &
  Record<string, MinecraftMusicScenePlaylist | undefined>
>

export type MinecraftMusicScenePlaylistManifestFailure = {
  readonly _tag: 'MinecraftMusicScenePlaylistManifestFailure'
  readonly message: AudioDiagnosticMessage
  readonly path: AudioDiagnosticPath
}

const manifestFailure = (
  path: string,
  message: string,
): Result.Result<never, MinecraftMusicScenePlaylistManifestFailure> => Result.fail({
  _tag: 'MinecraftMusicScenePlaylistManifestFailure',
  message: makeAudioDiagnosticMessage(message),
  path: makeAudioDiagnosticPath(path),
})

const failureValue = (path: string, message: string): MinecraftMusicScenePlaylistManifestFailure => ({
  _tag: 'MinecraftMusicScenePlaylistManifestFailure',
  message: makeAudioDiagnosticMessage(message),
  path: makeAudioDiagnosticPath(path),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isMissing = (value: unknown): value is undefined => Object.is(value, globalThis.undefined)

const isScene = (value: string): value is MinecraftMusicScene =>
  MINECRAFT_MUSIC_SCENES.some((scene) => scene === value)

const onlyKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlyArray<string>,
  path: string,
): Result.Result<null, MinecraftMusicScenePlaylistManifestFailure> => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return manifestFailure(path, `Unknown music playlist key: ${key}`)
    }
  }
  return Result.succeed(null)
}

type TickRangeInput = {
  readonly label: string
  readonly maximum: number
  readonly minimum: number
  readonly path: string
  readonly value: unknown
}

const readTickRange = ({
  label,
  maximum,
  minimum,
  path,
  value,
}: TickRangeInput): Result.Result<AudioDelayTicksType, MinecraftMusicScenePlaylistManifestFailure> => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return manifestFailure(path, `${label} must be an integer from ${minimum} through ${maximum}`)
  }
  return Result.succeed(makeAudioDelayTicks(value))
}

const fileAttributionFor = (
  raw: Readonly<Record<string, unknown>>,
  path: string,
): Result.Result<{ readonly attribution: AudioAssetAttribution; readonly file: AudioAssetPath }, MinecraftMusicScenePlaylistManifestFailure> => {
  const decodedAsset = decodeAudioAssetVariant({
    attribution: raw['attribution'],
    file: raw['file'],
    pitchRange: { maximum: UNITY, minimum: UNITY },
    volume: UNITY,
  })
  if (Result.isFailure(decodedAsset)) {
    return manifestFailure(path, decodedAsset.failure.message)
  }
  return Result.succeed({ attribution: decodedAsset.success.attribution, file: decodedAsset.success.file })
}

const eventIdFor = (
  value: unknown,
  path: string,
): Result.Result<MinecraftSoundEventIdType, MinecraftMusicScenePlaylistManifestFailure> => {
  if (typeof value !== 'string') {
    return manifestFailure(path, 'Music playlist eventId must be a non-empty string')
  }
  const eventId = makeMinecraftSoundEventId.result(value)
  if (Result.isFailure(eventId)) {
    return manifestFailure(path, eventId.failure.message)
  }
  if (!eventId.success.startsWith(MUSIC_EVENT_PREFIX) || eventId.success.length === MUSIC_EVENT_PREFIX.length) {
    return manifestFailure(path, `Music playlist eventId must start with ${MUSIC_EVENT_PREFIX} and include a track id`)
  }
  return Result.succeed(eventId.success)
}

const trackRecord = (
  raw: unknown,
  path: string,
): Result.Result<Readonly<Record<string, unknown>>, MinecraftMusicScenePlaylistManifestFailure> => {
  if (!isRecord(raw)) {
    return manifestFailure(path, 'Music playlist track must be an object')
  }
  const known = onlyKeys(raw, ['attribution', 'eventId', 'file'], path)
  if (Result.isFailure(known)) {
    return Result.fail(known.failure)
  }
  return Result.succeed(raw)
}

const trackFor = (
  raw: unknown,
  path: string,
): Result.Result<MinecraftMusicSceneTrack, MinecraftMusicScenePlaylistManifestFailure> => {
  const record = trackRecord(raw, path)
  if (Result.isFailure(record)) {
    return Result.fail(record.failure)
  }
  const asset = fileAttributionFor(record.success, path)
  if (Result.isFailure(asset)) {
    return Result.fail(asset.failure)
  }
  const eventId = eventIdFor(record.success['eventId'], `${path}.eventId`)
  if (Result.isFailure(eventId)) {
    return Result.fail(eventId.failure)
  }
  return Result.succeed({
    attribution: asset.success.attribution,
    eventId: eventId.success,
    file: asset.success.file,
  })
}

type AppendTrackOptions = {
  readonly index: number
  readonly path: string
  readonly raw: unknown
  readonly tracks: MinecraftMusicSceneTrack[]
}

const appendTrack = ({ tracks, raw, index, path }: AppendTrackOptions): Result.Result<null, MinecraftMusicScenePlaylistManifestFailure> => {
  const parsed = trackFor(raw, `${path}.tracks[${index}]`)
  if (Result.isFailure(parsed)) {
    return Result.fail(parsed.failure)
  }
  tracks.push(parsed.success)
  return Result.succeed(null)
}

const trackListFor = (
  raw: unknown,
  path: string,
): Result.Result<ReadonlyArray<MinecraftMusicSceneTrack>, MinecraftMusicScenePlaylistManifestFailure> => {
  if (!Array.isArray(raw) || raw.length === EMPTY_LENGTH) {
    return manifestFailure(`${path}.tracks`, 'Music scene playlist requires at least one track')
  }
  const tracks: MinecraftMusicSceneTrack[] = []
  for (const [index, track] of raw.entries()) {
    const parsed = appendTrack({ index, path, raw: track, tracks })
    if (Result.isFailure(parsed)) {
      return Result.fail(parsed.failure)
    }
  }
  return Result.succeed(tracks)
}

const playlistFor = (
  raw: unknown,
  path: string,
): Result.Result<MinecraftMusicScenePlaylist, MinecraftMusicScenePlaylistManifestFailure> => Result.gen(
  function* parseMusicScenePlaylist() {
    if (!isRecord(raw)) {
      return yield* manifestFailure(path, 'Music scene playlist must be an object')
    }
    yield* onlyKeys(raw, ['crossfadeTicks', 'maximumSilenceTicks', 'minimumSilenceTicks', 'tracks'], path)
    const tracks = yield* trackListFor(raw['tracks'], path)
    const minimumSilenceTicks = yield* readTickRange({
      label: 'minimumSilenceTicks',
      maximum: MAX_SILENCE_TICKS,
      minimum: ONE_TICK,
      path: `${path}.minimumSilenceTicks`,
      value: raw['minimumSilenceTicks'],
    })
    const maximumSilenceTicks = yield* readTickRange({
      label: 'maximumSilenceTicks',
      maximum: MAX_SILENCE_TICKS,
      minimum: minimumSilenceTicks,
      path: `${path}.maximumSilenceTicks`,
      value: raw['maximumSilenceTicks'],
    })
    const crossfadeTicks = yield* readTickRange({
      label: 'crossfadeTicks',
      maximum: MAX_CROSSFADE_TICKS,
      minimum: ONE_TICK,
      path: `${path}.crossfadeTicks`,
      value: raw['crossfadeTicks'],
    })
    return { crossfadeTicks, maximumSilenceTicks, minimumSilenceTicks, tracks }
  },
)

const attributionKey = (attribution: AudioAssetAttribution): string => {
  if (attribution.type === 'external') {
    return [
      attribution.type,
      attribution.author,
      attribution.workTitle,
      attribution.sourceUrl,
      attribution.licenseName,
      attribution.licenseUrl,
      String(attribution.modified),
    ].map((value) => `${value.length}:${value}`).join('')
  }
  return [
    attribution.type,
    attribution.generatorScript,
    attribution.licenseSpdx,
    attribution.licenseName,
    attribution.licenseFile,
    attribution.licenseUrl,
  ].map((value) => `${value.length}:${value}`).join('')
}

const sameTrack = (left: MinecraftMusicSceneTrack, right: MinecraftMusicSceneTrack): boolean =>
  left.file === right.file && attributionKey(left.attribution) === attributionKey(right.attribution)

const registerPlaylistEvents = (
  scene: MinecraftMusicScene,
  playlist: MinecraftMusicScenePlaylist,
  eventTracks: Map<string, MinecraftMusicSceneTrack>,
): Result.Result<null, MinecraftMusicScenePlaylistManifestFailure> => {
  for (const track of playlist.tracks) {
    const existing = eventTracks.get(track.eventId)
    if (!isMissing(existing) && !sameTrack(existing, track)) {
      return manifestFailure(`${scene}.tracks`, `Music event ${track.eventId} maps to conflicting assets`)
    }
    eventTracks.set(track.eventId, track)
  }
  return Result.succeed(null)
}

const playlistEntryFor = (
  scene: string,
  rawPlaylist: unknown,
  eventTracks: Map<string, MinecraftMusicSceneTrack>,
): Result.Result<{ readonly playlist: MinecraftMusicScenePlaylist; readonly scene: MinecraftMusicScene }, MinecraftMusicScenePlaylistManifestFailure> => {
  if (!isScene(scene)) {
    return manifestFailure(scene, `Unknown music scene: ${scene}`)
  }
  const playlist = playlistFor(rawPlaylist, scene)
  if (Result.isFailure(playlist)) {
    return Result.fail(playlist.failure)
  }
  const registered = registerPlaylistEvents(scene, playlist.success, eventTracks)
  if (Result.isFailure(registered)) {
    return Result.fail(registered.failure)
  }
  return Result.succeed({ playlist: playlist.success, scene })
}

const parseManifest = (
  input: unknown,
): Result.Result<MinecraftMusicScenePlaylistManifest, MinecraftMusicScenePlaylistManifestFailure> => Result.gen(
  function* parseMusicScenePlaylistManifest() {
    if (!isRecord(input)) {
      return yield* manifestFailure('$', 'Music scene playlist manifest must be an object')
    }
    const entries: Partial<Record<MinecraftMusicScene, MinecraftMusicScenePlaylist>> = {}
    const eventTracks = new Map<string, MinecraftMusicSceneTrack>()
    for (const [scene, rawPlaylist] of Object.entries(input)) {
      const entry = yield* playlistEntryFor(scene, rawPlaylist, eventTracks)
      entries[entry.scene] = entry.playlist
    }
    return entries
  },
)

/** Decode scene playlists without throwing on unknown input. */
export const decodeMinecraftMusicScenePlaylistManifest = (
  input: unknown,
): Result.Result<MinecraftMusicScenePlaylistManifest, MinecraftMusicScenePlaylistManifestFailure> => {
  const attempted = Result.try({
    catch: (): MinecraftMusicScenePlaylistManifestFailure => failureValue('$', 'Music scene playlist manifest could not be decoded'),
    try: () => parseManifest(input),
  })
  return Result.match(attempted, {
    onFailure: (failure) => Result.fail(failure),
    onSuccess: (decoded) => decoded,
  })
}

const randomTrackIndex = (length: number, random: unknown): Result.Result<number, MinecraftMusicScenePlaylistManifestFailure> => {
  if (typeof random !== 'number' || !Number.isFinite(random)) {
    return manifestFailure('random', 'Music playlist random value must be finite')
  }
  const normalized = Math.min(RANDOM_UPPER_BOUND, Math.max(FIRST_INDEX, random))
  return Result.succeed(Math.floor(normalized * length))
}

/** Select one track uniformly from the requested scene. */
export const selectMinecraftMusicSceneTrack = (
  input: { readonly manifest: MinecraftMusicScenePlaylistManifest; readonly random: unknown; readonly scene: MinecraftMusicScene },
): Result.Result<MinecraftMusicSceneTrack | null, MinecraftMusicScenePlaylistManifestFailure> => {
  const playlist = input.manifest[input.scene]
  if (isMissing(playlist)) {
    return Result.succeed(null)
  }
  return Result.map(randomTrackIndex(playlist.tracks.length, input.random), (index) => playlist.tracks[index] ?? null)
}

/** Convert licensed playlist paths to sample URLs used by the existing WebAudio cache. */
export const minecraftMusicScenePlaylistSampleManifest = (
  manifest: MinecraftMusicScenePlaylistManifest,
): AudioSampleManifest => {
  const entries = new Map<AudioSampleIdType, AudioSampleSource>()
  for (const playlist of Object.values(manifest)) {
    if (!isMissing(playlist)) {
      for (const track of playlist.tracks) {
        const sampleId = makeAudioSampleId(track.file)
        if (!entries.has(sampleId)) {
          entries.set(sampleId, { kind: 'url', preload: true, stream: true, url: makeAudioSampleUrl(track.file) })
        }
      }
    }
  }
  return entries
}

/** Build the event registry needed by the existing sound resolver and music player. */
export const minecraftMusicScenePlaylistRegistry = (
  manifest: MinecraftMusicScenePlaylistManifest,
): MinecraftSoundRegistry => {
  const events = new Map<MinecraftSoundEvent['id'], MinecraftSoundEvent>()
  for (const playlist of Object.values(manifest)) {
    if (!isMissing(playlist)) {
      for (const track of playlist.tracks) {
        if (!events.has(track.eventId)) {
          events.set(track.eventId, {
            id: track.eventId,
            replace: true,
            sounds: [{
              attenuationDistance: makeAudioDistance(MUSIC_DISTANCE),
              name: makeMinecraftSoundResourceId(track.file),
              pitch: makeAudioPlaybackRate(UNITY),
              preload: true,
              stream: true,
              type: 'sound',
              volume: makeAudioGain(UNITY),
              weight: makeAudioWeight(UNITY),
            }],
            subtitle: null,
          })
        }
      }
    }
  }
  return { events }
}

/** Return distinct attribution rows for tracks in a scene playlist manifest. */
export const minecraftMusicScenePlaylistCredits = (
  manifest: MinecraftMusicScenePlaylistManifest,
): ReadonlyArray<AudioAssetAttribution> => {
  const credits = new Map<string, AudioAssetAttribution>()
  for (const playlist of Object.values(manifest)) {
    if (!isMissing(playlist)) {
      for (const track of playlist.tracks) {
        credits.set(attributionKey(track.attribution), track.attribution)
      }
    }
  }
  return [...credits.values()]
}

/** Create the existing player definition for one selected playlist track. */
export const minecraftMusicDefinitionForSceneTrack = (
  playlist: MinecraftMusicScenePlaylist,
  track: MinecraftMusicSceneTrack,
): MinecraftMusicDefinition => ({
  max_delay: playlist.maximumSilenceTicks,
  min_delay: playlist.minimumSilenceTicks,
  replace_current_music: true,
  sound: track.eventId,
})

export const MINECRAFT_MUSIC_PLAYLIST_SILENCE_TICK_LIMIT: number = MAX_SILENCE_TICKS
export const MINECRAFT_MUSIC_PLAYLIST_CROSSFADE_TICK_LIMIT: number = MAX_CROSSFADE_TICKS

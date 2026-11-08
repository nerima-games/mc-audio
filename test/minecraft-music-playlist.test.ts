import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { Result } from 'effect'
import {
  AudioDistance,
  AudioGain,
  AudioPlaybackRate,
  AudioSampleId,
  AudioWeight,
  MinecraftSoundEventId,
  MinecraftSoundResourceId,
} from '../src/domain/audio-brands.js'
import {
  MINECRAFT_MUSIC_PLAYLIST_CROSSFADE_TICK_LIMIT,
  MINECRAFT_MUSIC_PLAYLIST_SILENCE_TICK_LIMIT,
  decodeMinecraftMusicScenePlaylistManifest,
  minecraftMusicScenePlaylistCredits,
  minecraftMusicScenePlaylistRegistry,
  minecraftMusicScenePlaylistSampleManifest,
  selectMinecraftMusicSceneTrack,
} from '../src/domain/minecraft-music-playlist.js'
import { mergeMinecraftSoundRegistries } from '../src/domain/minecraft-sounds.js'

const generatedAttribution = {
  generatorScript: 'scripts/audio/generate-title-music.ts',
  licenseFile: 'LICENSE',
  licenseName: 'MIT License',
  licenseSpdx: 'MIT',
  licenseUrl: 'https://opensource.org/license/MIT',
  type: 'generated',
} as const

const externalAttribution = {
  author: 'Example artist',
  licenseName: 'CC0 1.0 Universal',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  modified: false,
  sourceUrl: 'https://example.org/audio/title.ogg',
  type: 'external',
  workTitle: 'Title',
} as const

const track = (eventId: string, file: string, attribution: unknown = generatedAttribution) => ({
  attribution,
  eventId,
  file,
})

const playlist = (tracks: ReadonlyArray<unknown> = [track('mc-audio:music/title/01', 'audio/music/title-01.ogg')]) => ({
  crossfadeTicks: 40,
  maximumSilenceTicks: 400,
  minimumSilenceTicks: 200,
  tracks,
})

const decode = (input: unknown) => decodeMinecraftMusicScenePlaylistManifest(input)

describe('Minecraft music scene playlists', () => {
  it('decodes generated attribution and builds the existing sample and sound registries', () => {
    const decoded = decode({ title: playlist() })
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isFailure(decoded)) {
      return
    }

    const scene = decoded.success.title
    expect(scene?.tracks[0]?.attribution).toEqual(generatedAttribution)
    expect(minecraftMusicScenePlaylistSampleManifest(decoded.success).get(AudioSampleId('audio/music/title-01.ogg'))).toEqual({
      kind: 'url',
      preload: true,
      stream: true,
      url: 'audio/music/title-01.ogg',
    })
    expect(minecraftMusicScenePlaylistRegistry(decoded.success).events.get(MinecraftSoundEventId('mc-audio:music/title/01'))).toMatchObject({
      replace: true,
      sounds: [{ name: 'audio/music/title-01.ogg', stream: true, type: 'sound' }],
    })
    expect(minecraftMusicScenePlaylistCredits(decoded.success)).toEqual([generatedAttribution])
  })

  it('replaces a colliding registry event with the selected playlist asset', () => {
    const decoded = decode({ title: playlist() })
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isFailure(decoded)) {
      return
    }
    const eventId = MinecraftSoundEventId('mc-audio:music/title/01')
    const base = {
      events: new Map([[eventId, {
        id: eventId,
        replace: false,
        sounds: [{
          attenuationDistance: AudioDistance(16),
          name: MinecraftSoundResourceId('audio/base-title.ogg'),
          pitch: AudioPlaybackRate(1),
          preload: true,
          stream: true,
          type: 'sound' as const,
          volume: AudioGain(1),
          weight: AudioWeight(1),
        }],
        subtitle: null,
      }]]),
    }

    const merged = mergeMinecraftSoundRegistries(base, minecraftMusicScenePlaylistRegistry(decoded.success))

    expect(merged.events.get(eventId)?.sounds.map(({ name }) => name)).toEqual(['audio/music/title-01.ogg'])
  })

  it('accepts range boundaries and rejects adjacent out-of-range values', () => {
    expect(Result.isSuccess(decode({
      title: {
        crossfadeTicks: MINECRAFT_MUSIC_PLAYLIST_CROSSFADE_TICK_LIMIT,
        maximumSilenceTicks: MINECRAFT_MUSIC_PLAYLIST_SILENCE_TICK_LIMIT,
        minimumSilenceTicks: 1,
        tracks: [track('mc-audio:music/title/01', 'audio/title.ogg')],
      },
    }))).toBe(true)
    expect(Result.isFailure(decode({ title: playlist([track('mc-audio:music/title/01', '../title.ogg')]) }))).toBe(true)
    expect(Result.isFailure(decode({ title: { ...playlist(), minimumSilenceTicks: 0 } }))).toBe(true)
    expect(Result.isFailure(decode({ title: { ...playlist(), maximumSilenceTicks: MINECRAFT_MUSIC_PLAYLIST_SILENCE_TICK_LIMIT + 1 } }))).toBe(true)
    expect(Result.isFailure(decode({ title: { ...playlist(), maximumSilenceTicks: 199 } }))).toBe(true)
    expect(Result.isFailure(decode({ title: { ...playlist(), crossfadeTicks: 0 } }))).toBe(true)
    expect(Result.isFailure(decode({ title: { ...playlist(), crossfadeTicks: MINECRAFT_MUSIC_PLAYLIST_CROSSFADE_TICK_LIMIT + 1 } }))).toBe(true)
    expect(Result.isFailure(decode({ title: { ...playlist(), minimumSilenceTicks: '200' } }))).toBe(true)
    expect(Result.isFailure(decode({ title: { ...playlist(), maximumSilenceTicks: Number.NaN } }))).toBe(true)
    expect(Result.isFailure(decode({ title: { ...playlist(), crossfadeTicks: 1.5 } }))).toBe(true)
  })

  it('requires package-scoped event ids to avoid collisions with context fallback music', () => {
    expect(Result.isFailure(decode({ title: playlist([track('minecraft:music.game', 'audio/title.ogg')]) }))).toBe(true)
    expect(Result.isFailure(decode({ title: playlist([track('mc-audio:music/', 'audio/title.ogg')]) }))).toBe(true)
    expect(Result.isFailure(decode({ title: playlist([track('', 'audio/title.ogg')]) }))).toBe(true)
    expect(Result.isFailure(decode({ title: playlist([{ ...track('mc-audio:music/title/01', 'audio/title.ogg'), eventId: 1 }]) }))).toBe(true)
  })

  it('rejects unknown keys, unknown scenes, and malformed playlist or track values', () => {
    expect(Result.isFailure(decode(null))).toBe(true)
    expect(Result.isFailure(decode({ other: playlist() }))).toBe(true)
    expect(Result.isFailure(decode({ title: null }))).toBe(true)
    expect(Result.isFailure(decode({ title: { ...playlist(), extra: true } }))).toBe(true)
    expect(Result.isFailure(decode({ title: playlist([]) }))).toBe(true)
    expect(Result.isFailure(decode({ title: { ...playlist(), tracks: null } }))).toBe(true)
    expect(Result.isFailure(decode({ title: playlist([null]) }))).toBe(true)
    expect(Result.isFailure(decode({ title: playlist([{ ...track('mc-audio:music/title/01', 'audio/title.ogg'), extra: true }]) }))).toBe(true)
    expect(Result.isFailure(decode({ title: playlist([track('mc-audio:music/title/01', 'audio/title.ogg', { ...generatedAttribution, generatorScript: '../generate.ts' })]) }))).toBe(true)
  })

  it('selects tracks at random boundaries and returns a typed failure for invalid randomness', () => {
    const decoded = decode({ title: playlist([
      track('mc-audio:music/title/01', 'audio/title-01.ogg'),
      track('mc-audio:music/title/02', 'audio/title-02.ogg'),
    ]) })
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isFailure(decoded)) {
      return
    }

    const first = selectMinecraftMusicSceneTrack({ manifest: decoded.success, random: 0, scene: 'title' })
    const last = selectMinecraftMusicSceneTrack({ manifest: decoded.success, random: 1, scene: 'title' })
    expect(Result.isSuccess(first)).toBe(true)
    expect(Result.isSuccess(last)).toBe(true)
    if (Result.isSuccess(first)) {
      expect(first.success?.file).toBe('audio/title-01.ogg')
    }
    if (Result.isSuccess(last)) {
      expect(last.success?.file).toBe('audio/title-02.ogg')
    }
    expect(Result.isFailure(selectMinecraftMusicSceneTrack({ manifest: decoded.success, random: Number.NaN, scene: 'title' }))).toBe(true)
  })

  it('deduplicates identical generated attribution rows and rejects conflicting event files', () => {
    const sameTrack = track('mc-audio:music/title/01', 'audio/title.ogg')
    const decoded = decode({ title: playlist([sameTrack]), day: playlist([sameTrack]) })
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isFailure(decoded)) {
      return
    }
    expect(minecraftMusicScenePlaylistCredits(decoded.success)).toHaveLength(1)
    expect(minecraftMusicScenePlaylistSampleManifest(decoded.success).size).toBe(1)
    expect(minecraftMusicScenePlaylistRegistry(decoded.success).events.size).toBe(1)
    expect(Result.isFailure(decode({
      title: playlist([sameTrack]),
      day: playlist([track('mc-audio:music/title/01', 'audio/other.ogg')]),
    }))).toBe(true)
    expect(Result.isFailure(decode({
      title: playlist([sameTrack]),
      day: playlist([track('mc-audio:music/title/01', 'audio/title.ogg', externalAttribution)]),
    }))).toBe(true)
  })

  it('accepts distinct events that reuse a file and handles empty scene manifests', () => {
    const decoded = decode({
      title: playlist([
        track('mc-audio:music/title/01', 'audio/music/shared.ogg'),
        track('mc-audio:music/title/02', 'audio/music/shared.ogg'),
      ]),
    })
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isFailure(decoded)) {
      return
    }
    expect(minecraftMusicScenePlaylistSampleManifest(decoded.success).size).toBe(1)
    expect(minecraftMusicScenePlaylistRegistry(decoded.success).events.size).toBe(2)

    const empty = decode({})
    expect(Result.isSuccess(empty)).toBe(true)
    if (Result.isFailure(empty)) {
      return
    }
    expect(minecraftMusicScenePlaylistSampleManifest(empty.success).size).toBe(0)
    expect(minecraftMusicScenePlaylistRegistry(empty.success).events.size).toBe(0)
    expect(minecraftMusicScenePlaylistCredits(empty.success)).toEqual([])

    const missingPlaylist = { unknownScene: undefined }
    expect(minecraftMusicScenePlaylistSampleManifest(missingPlaylist).size).toBe(0)
    expect(minecraftMusicScenePlaylistRegistry(missingPlaylist).events.size).toBe(0)
    expect(minecraftMusicScenePlaylistCredits(missingPlaylist)).toEqual([])
  })

  it('returns null for absent scenes and empty caller-built playlists', () => {
    const decoded = decode({ title: playlist() })
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isFailure(decoded)) {
      return
    }
    expect(selectMinecraftMusicSceneTrack({ manifest: decoded.success, random: 0, scene: 'day' })).toEqual(Result.succeed(null))
    const titlePlaylist = decoded.success.title
    if (titlePlaylist === undefined) {
      throw new Error('expected the title playlist')
    }
    const emptyManifest = { title: { ...titlePlaylist, tracks: [] } }
    expect(selectMinecraftMusicSceneTrack({ manifest: emptyManifest, random: 0, scene: 'title' })).toEqual(Result.succeed(null))
  })

  it('returns a typed result without throwing for arbitrary manifest input', () => {
    fc.assert(fc.property(fc.anything(), (input) => {
      expect(() => decode(input)).not.toThrow()
      const decoded = decode(input)
      expect(Result.isSuccess(decoded) || Result.isFailure(decoded)).toBe(true)
    }), { numRuns: 500 })
    const uninspectable = new Proxy({}, {
      ownKeys: () => {
        throw new Error('cannot enumerate scene manifest')
      },
    })
    expect(() => decode(uninspectable)).not.toThrow()
    expect(Result.isFailure(decode(uninspectable))).toBe(true)
  })
})

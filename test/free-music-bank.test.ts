/* oxlint-disable max-statements, no-magic-numbers */
import { Effect, Option, Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { mergeAudioSampleManifests } from '../src/domain/audio-sample.js'
import {
  AudioDurationSecs,
  AudioGain,
  AudioPlaybackRate,
  AudioSampleId,
  AudioSampleRate,
  AudioSampleUrl,
  MinecraftSoundEventId,
  MinecraftSoundNamespace,
  MinecraftSoundResourceId,
} from '../src/domain/audio-brands.js'
import {
  FREE_MINECRAFT_MUSIC_TRACKS,
  createFreeMinecraftMusicManifest,
  createFreeMinecraftMusicPack,
  createFreeMinecraftMusicRegistry,
  generateFreeMusicWav,
} from '../src/domain/free-music-bank.js'
import {
  MINECRAFT_26_2_SOUNDS_JSON,
  type Minecraft26_2SoundVariantDefinition,
} from '../src/domain/minecraft-26-2-sound-data.js'
import { mergeMinecraftSoundRegistries, parseMinecraftSoundsJson } from '../src/domain/minecraft-sounds-parser.js'
import { resolveMinecraftSound } from '../src/domain/minecraft-sounds-resolver.js'
import { makeWebAudioBackend } from '../src/domain/webaudio-adapter.js'
import { makeFakeWebAudio } from './fake-webaudio.js'

const success = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isSuccess(result)) {
    return result.success
  }
  throw new Error('Expected a successful result')
}

const wav = (id: string, options: Parameters<typeof generateFreeMusicWav>[1] = {}): ArrayBuffer =>
  success(generateFreeMusicWav(MinecraftSoundResourceId(id), options))

const freeManifest = (options: Parameters<typeof createFreeMinecraftMusicManifest>[0] = {}) =>
  success(createFreeMinecraftMusicManifest(options))

const freePack = (options: Parameters<typeof createFreeMinecraftMusicPack>[0] = {}) =>
  success(createFreeMinecraftMusicPack(options))

const registryRecord = (registry: ReturnType<typeof createFreeMinecraftMusicRegistry>) =>
  Object.fromEntries(registry.events)

const resolveSound = (registry: ReturnType<typeof createFreeMinecraftMusicRegistry>, id: string, random?: number) =>
  success(resolveMinecraftSound(registry, MinecraftSoundEventId(id), random))

const officialMusicVariantMetadata = (variant: Minecraft26_2SoundVariantDefinition) => {
  if (typeof variant === 'string') {
    return { type: 'sound', volume: 1, weight: 1, stream: false }
  }
  return {
    type: variant.type ?? 'sound',
    volume: variant.volume ?? 1,
    weight: variant.weight ?? 1,
    stream: variant.stream ?? false,
  }
}

const EXPECTED_FREE_MUSIC_EVENT_SIZES = {
  'minecraft:music.creative': 7,
  'minecraft:music.credits': 1,
  'minecraft:music.dragon': 1,
  'minecraft:music.end': 1,
  'minecraft:music.game': 32,
  'minecraft:music.menu': 9,
  'minecraft:music.nether.basalt_deltas': 5,
  'minecraft:music.nether.crimson_forest': 5,
  'minecraft:music.nether.nether_wastes': 5,
  'minecraft:music.nether.soul_sand_valley': 5,
  'minecraft:music.nether.warped_forest': 0,
  'minecraft:music.overworld.badlands': 14,
  'minecraft:music.overworld.bamboo_jungle': 12,
  'minecraft:music.overworld.cherry_grove': 11,
  'minecraft:music.overworld.deep_dark': 2,
  'minecraft:music.overworld.desert': 10,
  'minecraft:music.overworld.dripstone_caves': 14,
  'minecraft:music.overworld.flower_forest': 12,
  'minecraft:music.overworld.forest': 23,
  'minecraft:music.overworld.frozen_peaks': 12,
  'minecraft:music.overworld.grove': 14,
  'minecraft:music.overworld.jagged_peaks': 15,
  'minecraft:music.overworld.jungle': 12,
  'minecraft:music.overworld.lush_caves': 15,
  'minecraft:music.overworld.meadow': 7,
  'minecraft:music.overworld.old_growth_taiga': 20,
  'minecraft:music.overworld.snowy_slopes': 8,
  'minecraft:music.overworld.sparse_jungle': 12,
  'minecraft:music.overworld.stony_peaks': 12,
  'minecraft:music.overworld.sulfur_caves': 14,
  'minecraft:music.overworld.swamp': 4,
  'minecraft:music.under_water': 3,
  'minecraft:music_disc.11': 1,
  'minecraft:music_disc.13': 1,
  'minecraft:music_disc.5': 1,
  'minecraft:music_disc.blocks': 1,
  'minecraft:music_disc.bounce': 1,
  'minecraft:music_disc.cat': 1,
  'minecraft:music_disc.chirp': 1,
  'minecraft:music_disc.creator': 1,
  'minecraft:music_disc.creator_music_box': 1,
  'minecraft:music_disc.far': 1,
  'minecraft:music_disc.lava_chicken': 1,
  'minecraft:music_disc.mall': 1,
  'minecraft:music_disc.mellohi': 1,
  'minecraft:music_disc.otherside': 1,
  'minecraft:music_disc.pigstep': 1,
  'minecraft:music_disc.precipice': 1,
  'minecraft:music_disc.relic': 1,
  'minecraft:music_disc.stal': 1,
  'minecraft:music_disc.strad': 1,
  'minecraft:music_disc.tears': 1,
  'minecraft:music_disc.wait': 1,
  'minecraft:music_disc.ward': 1,
  'minecraft:music.free_game': 1,
  'minecraft:music.free_sulfur_caves': 1,
} as const

describe('free Minecraft music bank', () => {
  it('merges additions without replacing an existing sample source', () => {
    const base = new Map([
      [AudioSampleId('shared'), { kind: 'url' as const, url: AudioSampleUrl('/vanilla.ogg') }],
    ])
    const additions = new Map([
      [AudioSampleId('shared'), { kind: 'url' as const, url: AudioSampleUrl('/generated.ogg') }],
      [AudioSampleId('free'), { kind: 'array-buffer' as const, data: new ArrayBuffer(0) }],
    ])

    const merged = mergeAudioSampleManifests(base, additions)
    expect(merged.get(AudioSampleId('shared'))).toEqual(base.get(AudioSampleId('shared')))
    expect(merged.get(AudioSampleId('free'))).toEqual(additions.get(AudioSampleId('free')))
  })

  it('generates deterministic PCM WAV samples with valid headers', () => {
    const first = wav('minecraft:music/free_game', {
      durationSecs: AudioDurationSecs(0.01),
      sampleRate: AudioSampleRate(8000),
    })
    const second = wav('minecraft:music/free_game', {
      durationSecs: AudioDurationSecs(0.01),
      sampleRate: AudioSampleRate(8000),
    })
    const audible = wav('minecraft:music/free_game', {
      durationSecs: AudioDurationSecs(0.5),
      sampleRate: AudioSampleRate(8000),
    })
    const view = new DataView(first)

    expect(first.byteLength).toBe(44 + 80 * 2)
    expect(view.getUint32(0, false)).toBe(0x52494646)
    expect(view.getUint32(8, false)).toBe(0x57415645)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(8000)
    expect([...new Int16Array(audible, 44)].some((sample) => sample !== 0)).toBe(true)
    expect(new Uint8Array(first)).toEqual(new Uint8Array(second))
  })

  it('uses safe bounds for invalid generation options', () => {
    const low = wav('minecraft:music/free_game', {
      durationSecs: AudioDurationSecs(0.001),
      sampleRate: AudioSampleRate(1),
    })
    const high = wav('minecraft:music/free_game', {
      durationSecs: AudioDurationSecs(0.001),
      sampleRate: AudioSampleRate(100000),
    })
    const malformedRate = wav('minecraft:music/free_game', {
      durationSecs: AudioDurationSecs(0.001),
      // @ts-expect-error Simulate an invalid sample rate from an untyped JavaScript caller.
      sampleRate: Number.NaN,
    })
    const defaulted = wav('minecraft:music/free_game', { durationSecs: AudioDurationSecs(0) })
    const omittedDuration = wav('minecraft:music/free_game', { sampleRate: AudioSampleRate(8000) })

    expect(Option.isNone(AudioSampleRate.option(Number.NaN))).toBe(true)
    expect(Option.isNone(AudioDurationSecs.option(Number.NaN))).toBe(true)
    expect(new DataView(low).getUint32(24, true)).toBe(8000)
    expect(new DataView(high).getUint32(24, true)).toBe(48000)
    expect(new DataView(malformedRate).getUint32(24, true)).toBe(22050)
    expect(new DataView(defaulted).getUint32(24, true)).toBe(22050)
    expect(defaulted.byteLength).toBe(44 + 8 * 22050 * 2)
    expect(omittedDuration.byteLength).toBe(44 + 8 * 8000 * 2)
    expect(Result.isFailure(generateFreeMusicWav(MinecraftSoundResourceId('minecraft:music/unknown')))).toBe(true)
  })

  it('rejects a malformed resource id before track lookup', () => {
    // @ts-expect-error Simulate an invalid resource ID from an untyped JavaScript caller.
    const result = generateFreeMusicWav('')

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ _tag: 'FreeMusicBankFailure', path: 'soundId' })
    }
  })

  it('rejects synthesis durations that would create an unbounded wav allocation', () => {
    const result = generateFreeMusicWav(MinecraftSoundResourceId('minecraft:music/free_game'), {
      durationSecs: AudioDurationSecs(Number.MAX_VALUE),
    })
    expect(Result.isFailure(result)).toBe(true)
  })

  it('returns the duration failure when building a manifest would exceed its allocation limit', () => {
    const result = createFreeMinecraftMusicManifest({ durationSecs: AudioDurationSecs(61) })

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ _tag: 'FreeMusicBankFailure', path: 'durationSecs' })
    }
  })

  it('exposes all generated tracks through a Minecraft-compatible pack', () => {
    const manifest = freeManifest({ durationSecs: AudioDurationSecs(0.01), sampleRate: AudioSampleRate(8000) })
    const registry = createFreeMinecraftMusicRegistry()
    const pack = freePack({ durationSecs: AudioDurationSecs(0.01), sampleRate: AudioSampleRate(8000) })
    const events = registryRecord(registry)
    const eventIds = Object.keys(EXPECTED_FREE_MUSIC_EVENT_SIZES)

    expect([...manifest.keys()]).toEqual(FREE_MINECRAFT_MUSIC_TRACKS.map((track) => AudioSampleId(track.soundId)))
    expect(Object.keys(events)).toEqual(eventIds)
    expect(Object.keys(events)).toHaveLength(56)
    expect(Object.values(events).every((event) => event.replace === false)).toBe(true)
    expect(pack.manifest).toEqual(manifest)
    expect(pack.registry).toEqual(registry)

    for (const [eventId, expectedSize] of Object.entries(EXPECTED_FREE_MUSIC_EVENT_SIZES)) {
      expect(events[eventId]?.sounds).toHaveLength(expectedSize)
    }

    for (const track of FREE_MINECRAFT_MUSIC_TRACKS) {
      expect(events[track.eventId]?.sounds.some((sound) => sound.name === track.soundId)).toBe(true)
      expect(manifest.get(AudioSampleId(track.soundId))?.kind).toBe('array-buffer')
      expect(manifest.get(AudioSampleId(track.soundId))?.stream).toBe(true)
    }

    expect(resolveSound(registry, 'minecraft:music.free_game', 0).soundId).toBe(
      'minecraft:music/free_game',
    )
    expect(resolveSound(registry, 'minecraft:music.game', 0).soundId).toBe(
      'minecraft:music/free_game',
    )
    expect(resolveSound(registry, 'minecraft:music.game', 0.99).soundId).toBe(
      'minecraft:music/free_game',
    )
    expect(resolveSound(registry, 'minecraft:music.free_sulfur_caves', 0).soundId).toBe(
      'minecraft:music/free_sulfur_caves',
    )
    expect(resolveSound(registry, 'minecraft:music.overworld.swamp', 0).soundId).toBe(
      'minecraft:music/game/ebb',
    )
    expect(resolveSound(registry, 'minecraft:music_disc.bounce').soundId).toBe(
      'minecraft:records/bounce',
    )
    expect(resolveSound(registry, 'minecraft:music.under_water').volume).toBe(0.4)
    const gameSounds = events['minecraft:music.game']?.sounds
    expect(gameSounds?.[7]).toMatchObject({
      name: 'minecraft:music/game/ebb',
      stream: true,
      type: 'sound',
      volume: 0.4,
      weight: 2,
    })
    expect(gameSounds?.[12]).toMatchObject({
      name: 'minecraft:music/game/home',
      stream: true,
      type: 'sound',
      volume: 0.4,
      weight: 2,
    })
    expect(gameSounds?.[18]).toMatchObject({
      name: 'minecraft:music/game/memories',
      stream: true,
      type: 'sound',
      volume: 0.4,
      weight: 2,
    })
    expect(gameSounds?.[21]).toMatchObject({
      name: 'minecraft:music/game/nightly',
      stream: true,
      type: 'sound',
      volume: 0.4,
      weight: 2,
    })
    expect(gameSounds?.[26]).toMatchObject({
      name: 'minecraft:music/game/shores',
      stream: true,
      type: 'sound',
      volume: 0.4,
      weight: 2,
    })
    expect(events['minecraft:music.creative']?.sounds[0]).toMatchObject({
      name: 'minecraft:music.game',
      stream: false,
      type: 'event',
      volume: 1,
      weight: 1,
    })
    expect(events['minecraft:music.under_water']?.sounds.every((sound) => (
      sound.name === 'minecraft:music/free_underwater'
      && sound.volume === 0.4
      && sound.weight === 1
    ))).toBe(true)
    expect(Object.keys(events)
      .filter((eventId) => eventId.startsWith('minecraft:music_disc.'))
      .every((eventId) => events[eventId]?.sounds[0]?.name === 'minecraft:records/bounce'))
      .toBe(true)

    for (const [eventId, expectedSize] of Object.entries(EXPECTED_FREE_MUSIC_EVENT_SIZES)) {
      const event = events[eventId]
      expect(event?.sounds).toHaveLength(expectedSize)
      expect(event?.sounds.every((sound) => (
        sound.attenuationDistance === 16
        && sound.pitch === 1
        && sound.preload
        && (sound.type === 'event' || sound.stream)
      ))).toBe(true)
      for (const sound of event?.sounds ?? []) {
        if (sound.type === 'sound') {
          expect(manifest.get(AudioSampleId(sound.name))?.kind).toBe('array-buffer')
        }
      }
    }

    expect(Object.values(events).every((event) => event.replace === false)).toBe(true)
    const base = success(parseMinecraftSoundsJson({
      'music.game': { sounds: ['music/game/vanilla'] },
    }, { namespace: MinecraftSoundNamespace('minecraft') }))
    const merged = mergeMinecraftSoundRegistries(base, registry)
    const mergedEvents = registryRecord(merged)
    expect(mergedEvents['minecraft:music.game']?.replace).toBe(false)
    expect(mergedEvents['minecraft:music.game']?.sounds).toHaveLength(33)
    expect(mergedEvents['minecraft:music.game']?.sounds[0]?.name).toBe('minecraft:music/game/vanilla')
    expect(mergedEvents['minecraft:music.game']?.sounds.some((sound) => (
      sound.name === 'minecraft:music/game/shores'
      && sound.volume === 0.4
      && sound.weight === 2
    ))).toBe(true)
  })

  it('preserves official music event topology and selection metadata', () => {
    const registry = createFreeMinecraftMusicRegistry()
    const events = registryRecord(registry)
    const officialMusicEvents = Object.entries(MINECRAFT_26_2_SOUNDS_JSON)
      .filter(([eventId]) => eventId.startsWith('music.') || eventId.startsWith('music_disc.'))
    const officialEventIds = officialMusicEvents.map(([eventId]) => `minecraft:${eventId}`)

    expect(Object.keys(events).filter((eventId) => officialEventIds.includes(eventId))).toEqual(
      officialEventIds,
    )

    for (const [eventId, definition] of officialMusicEvents) {
      const actualVariants = events[`minecraft:${eventId}`]?.sounds ?? []
      expect(actualVariants).toHaveLength(definition.sounds.length)
      expect(actualVariants.map(({ type, volume, weight, stream }) => ({ type, volume, weight, stream }))).toEqual(
        definition.sounds.map(officialMusicVariantMetadata),
      )
    }
  })

  it('plays a generated track through the concrete WebAudio backend', async () => {
    const fake = makeFakeWebAudio({ decodedDurationSecs: 0.2 })
    const generatedPack = freePack({ durationSecs: AudioDurationSecs(0.01), sampleRate: AudioSampleRate(8000) })
    const audio = await Effect.runPromise(makeWebAudioBackend({
      global: fake.global,
      sampleManifest: generatedPack.manifest,
    }))

    await Effect.runPromise(audio.unlock)
    await Effect.runPromise(audio.playMusic({
      gain: AudioGain(1),
      playbackRate: AudioPlaybackRate(1),
      soundId: MinecraftSoundResourceId('minecraft:music/free_game'),
      stream: true,
    }))

    expect(fake.context()?.bufferSources).toHaveLength(1)
    expect(fake.context()?.oscillators).toHaveLength(0)
  })
})


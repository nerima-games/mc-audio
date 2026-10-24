import { describe, expect, it } from 'vitest'
import { Result } from 'effect'
import {
  AudioSampleId,
  AudioSampleUrl,
  AudioDistance,
  AudioGain,
  AudioPlaybackRate,
  AudioWeight,
  MinecraftSoundEventId,
  MinecraftSoundNamespace,
  MinecraftSoundResourceId,
} from '../src/domain/audio-brands.js'
import {
  type MinecraftSoundEvent,
  mergeMinecraftSoundRegistries,
  minecraftSoundAssetUrl,
  minecraftSoundManifest,
  normalizeMinecraftSoundId,
  parseMinecraftSoundsJson,
  resolveMinecraftSound,
  selectMinecraftSoundVariant,
} from '../src/domain/minecraft-sounds'

const success = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) {
    throw new Error('expected a successful result')
  }
  return result.success
}

const NAMESPACE = MinecraftSoundNamespace('minecraft')
const parse = (input: unknown) => parseMinecraftSoundsJson(input, { namespace: NAMESPACE })

const BASE_SOUNDS = {
  'block.break': {
    subtitle: 'subtitles.block.break',
    sounds: [
      'block/stone',
      {
        name: 'custom:rare',
        volume: 0.5,
        pitch: 1.25,
        weight: 3,
        stream: true,
        attenuation_distance: 32,
        preload: true,
      },
    ],
  },
  'entity.echo': {
    sounds: [
      {
        name: 'block.break',
        type: 'event',
        volume: 0.5,
        pitch: 2,
        stream: true,
        attenuation_distance: 24,
        preload: true,
      },
    ],
  },
} as const

describe('Minecraft sounds.json data layer', () => {
  it('parses defaults, qualified ids, and all supported variant properties', () => {
    const registry = success(parse(BASE_SOUNDS))
    const event = registry.events.get(MinecraftSoundEventId('minecraft:block.break'))
    const [defaultVariant, configuredVariant] = event?.sounds ?? []

    expect(event).toMatchObject({
      id: 'minecraft:block.break',
      replace: false,
      subtitle: 'subtitles.block.break',
    })
    expect(defaultVariant).toMatchObject({
      name: 'minecraft:block/stone',
      type: 'sound',
      volume: 1,
      pitch: 1,
      weight: 1,
      stream: false,
      attenuationDistance: 16,
      preload: false,
    })
    expect(configuredVariant).toMatchObject({
      name: 'custom:rare',
      type: 'sound',
      volume: 0.5,
      pitch: 1.25,
      weight: 3,
      stream: true,
      attenuationDistance: 32,
      preload: true,
    })
  })

  it('accepts the full non-negative volume and pitch values used by official data', () => {
    const registry = success(parse({
      'block.high-range': {
        sounds: [{ name: 'block/high-range', volume: 2, pitch: 2.4 }],
      },
    }))

    expect(registry.events.get(MinecraftSoundEventId('minecraft:block.high-range'))?.sounds[0]).toMatchObject({
      volume: 2,
      pitch: 2.4,
    })
  })

  it('uses an empty diagnostic path when a JavaScript caller supplies a non-string path', () => {
    const result = normalizeMinecraftSoundId('bad/path?', NAMESPACE, 1)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure.path).toBe('')
    }
  })

  it('selects weighted variants deterministically and resolves event references', () => {
    const registry = success(parse(BASE_SOUNDS))
    const first = registry.events.get(MinecraftSoundEventId('minecraft:block.break'))
    if (first === undefined) {
      throw new Error('expected block.break sound event')
    }
    expect(success(selectMinecraftSoundVariant(first, 0)).name).toBe('minecraft:block/stone')
    expect(success(selectMinecraftSoundVariant(first, 0.99)).name).toBe('custom:rare')
    expect(success(selectMinecraftSoundVariant(first, Number.NaN)).name).toBe('minecraft:block/stone')
    expect(success(selectMinecraftSoundVariant(first, 1)).name).toBe('custom:rare')

    const singletonEvent: MinecraftSoundEvent = {
      id: MinecraftSoundEventId('minecraft:zero'),
      replace: false,
      subtitle: null,
      sounds: [
        {
          name: MinecraftSoundResourceId('minecraft:zero'),
          type: 'sound',
          volume: AudioGain(1),
          pitch: AudioPlaybackRate(1),
          weight: AudioWeight(1),
          stream: false,
          attenuationDistance: AudioDistance(16),
          preload: false,
        },
      ],
    }
    expect(success(selectMinecraftSoundVariant(singletonEvent, 0)).name).toBe('minecraft:zero')
    expect(success(selectMinecraftSoundVariant({
      ...singletonEvent,
      sounds: [
        {
          name: MinecraftSoundResourceId('minecraft:zero'),
          type: 'sound',
          volume: AudioGain(1),
          pitch: AudioPlaybackRate(1),
          weight: AudioWeight(1),
          stream: false,
          attenuationDistance: AudioDistance(16),
          preload: false,
        },
        {
          name: MinecraftSoundResourceId('minecraft:zero-second'),
          type: 'sound',
          volume: AudioGain(1),
          pitch: AudioPlaybackRate(1),
          weight: AudioWeight(1),
          stream: false,
          attenuationDistance: AudioDistance(16),
          preload: false,
        },
      ],
    }, 0)).name).toBe('minecraft:zero')

    const overflowingWeights = success(parse({
      'entity.huge-weight': {
        sounds: [
          { name: 'block/first', weight: Number.MAX_VALUE },
          { name: 'block/last', weight: Number.MAX_VALUE },
        ],
      },
    }))
    expect(success(resolveMinecraftSound(
      overflowingWeights,
      MinecraftSoundEventId('minecraft:entity.huge-weight'),
      0.5,
    )).soundId).toBe('minecraft:block/last')

    expect(success(resolveMinecraftSound(registry, MinecraftSoundEventId('minecraft:entity.echo')))).toMatchObject({
      eventId: 'minecraft:entity.echo',
      soundId: 'minecraft:block/stone',
      volume: 0.5,
      pitch: 2,
      stream: true,
      attenuationDistance: 24,
      preload: true,
    })
  })

  it('merges resource-pack overlays and creates direct asset manifests', () => {
    const base = success(parse({
      'block.break': { subtitle: 'base.subtitle', sounds: ['block/stone'] },
      'block.place': { sounds: ['block/wood'] },
    }))
    const overlay = success(parse({
      'block.break': { sounds: ['block/metal'] },
      'block.place': { replace: true, sounds: ['block/custom'] },
      'item.pickup': { sounds: ['item/pickup.ogg'] },
    }))
    const merged = mergeMinecraftSoundRegistries(base, overlay)

    expect(merged.events.get(MinecraftSoundEventId('minecraft:block.break'))).toMatchObject({
      subtitle: 'base.subtitle',
      sounds: [
        { name: 'minecraft:block/stone' },
        { name: 'minecraft:block/metal' },
      ],
    })
    expect(merged.events.get(MinecraftSoundEventId('minecraft:block.place'))?.sounds).toStrictEqual([
      expect.objectContaining({ name: 'minecraft:block/custom' }),
    ])
    expect(mergeMinecraftSoundRegistries(base, success(parse({}))).events.get(MinecraftSoundEventId('minecraft:block.place'))).toBeDefined()
    expect(mergeMinecraftSoundRegistries(success(parse({})), overlay).events.get(MinecraftSoundEventId('minecraft:item.pickup'))).toBeDefined()
    const manifest = success(minecraftSoundManifest(merged, AudioSampleUrl('/packs/base/')))
    expect([...manifest.keys()]).toStrictEqual([
      'minecraft:block/custom',
      'minecraft:block/metal',
      'minecraft:block/stone',
      'minecraft:item/pickup',
    ])
    expect(minecraftSoundAssetUrl(MinecraftSoundResourceId('custom:rare'), AudioSampleUrl('/packs/base/'))).toBe(
      '/packs/base/assets/custom/sounds/rare.ogg',
    )
  })

  it('retains inherited preload and stream metadata when a sound is repeated', () => {
    const registry = success(parse({
      'sound.true-first': {
        sounds: [{ name: 'shared/true', preload: true, stream: true }],
      },
      'sound.true-second': { sounds: ['shared/true'] },
      'sound.false-first': { sounds: ['shared/false'] },
      'sound.false-second': { sounds: ['shared/false'] },
    }))

    const manifest = success(minecraftSoundManifest(registry, AudioSampleUrl('/packs')))
    expect([...manifest.keys()]).toStrictEqual(['minecraft:shared/false', 'minecraft:shared/true'])
    expect(manifest.get(AudioSampleId('minecraft:shared/false'))).toMatchObject({ preload: false, stream: false })
    expect(manifest.get(AudioSampleId('minecraft:shared/true'))).toMatchObject({ preload: true, stream: true })
  })

  it('rejects malformed resource-pack data at the data boundary', () => {
    const invalidInputs: unknown[] = [
      null,
      { 'block.break': { sounds: {} } },
      { 'bad:id:again': { sounds: ['block/stone'] } },
      { 'block.break': { sounds: [42] } },
      { 'block.break': { sounds: [''] } },
      { 'block.break': { sounds: ['Bad:stone'] } },
      { 'block.break': { sounds: [{ name: 'block/stone', type: 'other' }] } },
      { 'block.break': { sounds: [{ name: 'block/../stone' }] } },
      { 'block.break': { sounds: [{ name: 'block/./stone' }] } },
      { 'block.break': { sounds: [{ name: 'block/stone', weight: 1.5 }] } },
      { 'block.break': { sounds: [{ name: 'block/stone', volume: -0.1 }] } },
      { 'block.break': { sounds: [{ name: 'block/stone', pitch: -0.1 }] } },
      { 'block.break': { sounds: [{ name: 'block/stone', stream: 'yes' }] } },
      { 'block.break': { sounds: ['block/stone'], unknown: true } },
      { 'block.break': { sounds: ['block/stone'], subtitle: 1 } },
    ]

    for (const input of invalidInputs) {
      expect(Result.isFailure(parse(input))).toBe(true)
    }
    expect(Result.isFailure(Reflect.apply(parseMinecraftSoundsJson, undefined, [{}, { namespace: 'BadNamespace' }]))).toBe(true)
    expect(Result.isFailure(parse({ 'block.break': { sounds: [{ name: 'block/stone', volume: 0, pitch: 0 }] } }))).toBe(true)
    expect(success(parse({ 'block.break': { sounds: [{ name: 'block/stone', volume: 0, pitch: 0.25 }] } })).events
      .get(MinecraftSoundEventId('minecraft:block.break'))?.sounds[0]).toMatchObject({ pitch: 0.25, volume: 0 })
  })

  it('reports the invalid numeric property at its source path', () => {
    const invalidValues = [
      { input: { 'block.break': { sounds: [{ name: 'block/stone', volume: -1 }] } }, path: 'block.break.sounds[0].volume' },
      { input: { 'block.break': { sounds: [{ name: 'block/stone', pitch: 0 }] } }, path: 'block.break.sounds[0].pitch' },
      { input: { 'block.break': { sounds: [{ name: 'block/stone', weight: 0 }] } }, path: 'block.break.sounds[0].weight' },
      { input: { 'block.break': { sounds: [{ name: 'block/stone', attenuation_distance: 0 }] } }, path: 'block.break.sounds[0].attenuation_distance' },
    ]

    for (const { input, path } of invalidValues) {
      const result = parse(input)
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({ _tag: 'MinecraftSoundsParseFailure', path })
      }
    }
  })

  it('reports missing and cyclic event references and empty events', () => {
    expect(success(parse({ 'entity.empty': { sounds: [] } })).events.get(MinecraftSoundEventId('minecraft:entity.empty'))?.sounds).toStrictEqual([])

    const missing = success(parse({ 'entity.missing': { sounds: [{ name: 'entity.other', type: 'event' }] } }))
    expect(Result.isFailure(resolveMinecraftSound(missing, MinecraftSoundEventId('minecraft:entity.missing')))).toBe(true)

    const cyclic = success(parse({
      'entity.one': { sounds: [{ name: 'entity.two', type: 'event' }] },
      'entity.two': { sounds: [{ name: 'entity.one', type: 'event' }] },
    }))
    expect(Result.isFailure(resolveMinecraftSound(cyclic, MinecraftSoundEventId('minecraft:entity.one')))).toBe(true)
    expect(Result.isFailure(minecraftSoundManifest(cyclic, AudioSampleUrl('/packs')))).toBe(true)

    const emptyReference = success(parse({
      'entity.wrapper': { sounds: [{ name: 'entity.empty', type: 'event' }] },
      'entity.empty': { sounds: [] },
    }))
    const emptyResolution = resolveMinecraftSound(emptyReference, MinecraftSoundEventId('minecraft:entity.wrapper'))
    expect(Result.isFailure(emptyResolution)).toBe(true)
    if (Result.isFailure(emptyResolution)) {
      expect(emptyResolution.failure).toMatchObject({
        _tag: 'MinecraftSoundResolutionFailure',
        eventId: 'minecraft:entity.empty',
        message: 'Sound event minecraft:entity.empty has no sound variants',
      })
    }

    const inherited = success(parse({
      wrapper: { sounds: [{ name: 'target', type: 'event' }] },
      target: { sounds: [{ name: 'block/target', preload: true, stream: true }] },
    }))
    expect(success(resolveMinecraftSound(inherited, MinecraftSoundEventId('minecraft:wrapper')))).toMatchObject({
      soundId: 'minecraft:block/target',
      preload: true,
      stream: true,
    })
    expect([...success(minecraftSoundManifest(inherited, AudioSampleUrl('/packs'))).keys()]).toStrictEqual(['minecraft:block/target'])
    expect(Result.isFailure(selectMinecraftSoundVariant({
        id: MinecraftSoundEventId('minecraft:empty'),
        replace: false,
        subtitle: null,
        sounds: [],
      }))).toBe(true)
  })

  it('rejects nested event multipliers that overflow playback brands and manifests with missing references', () => {
    const pitchOverflow = success(parse({
      'entity.pitch-wrapper': { sounds: [{ name: 'entity.pitch-target', type: 'event', pitch: 1e308 }] },
      'entity.pitch-target': { sounds: [{ name: 'block/pitch', pitch: 1e308 }] },
    }))
    const pitchResult = resolveMinecraftSound(pitchOverflow, MinecraftSoundEventId('minecraft:entity.pitch-wrapper'))
    expect(Result.isFailure(pitchResult)).toBe(true)
    if (Result.isFailure(pitchResult)) {
      expect(pitchResult.failure).toMatchObject({
        _tag: 'MinecraftSoundResolutionFailure',
        eventId: 'minecraft:entity.pitch-wrapper',
        message: 'Audio playback rate must be finite and positive',
      })
    }

    const volumeOverflow = success(parse({
      'entity.volume-wrapper': { sounds: [{ name: 'entity.volume-target', type: 'event', volume: 1e308 }] },
      'entity.volume-target': { sounds: [{ name: 'block/volume', volume: 1e308 }] },
    }))
    const volumeResult = resolveMinecraftSound(volumeOverflow, MinecraftSoundEventId('minecraft:entity.volume-wrapper'))
    expect(Result.isFailure(volumeResult)).toBe(true)
    if (Result.isFailure(volumeResult)) {
      expect(volumeResult.failure).toMatchObject({
        _tag: 'MinecraftSoundResolutionFailure',
        eventId: 'minecraft:entity.volume-wrapper',
        message: 'Audio gain must be finite and non-negative',
      })
    }

    const missing = success(parse({
      'entity.wrapper': { sounds: [{ name: 'entity.missing', type: 'event' }] },
    }))
    const manifest = minecraftSoundManifest(missing, AudioSampleUrl('/packs'))
    expect(Result.isFailure(manifest)).toBe(true)
    if (Result.isFailure(manifest)) {
      expect(manifest.failure).toMatchObject({
        _tag: 'MinecraftSoundResolutionFailure',
        eventId: 'minecraft:entity.missing',
        message: 'Unknown Minecraft sound event: minecraft:entity.missing',
      })
    }
  })

  it('rejects sound event ids that normalize to the same resource id', () => {
    expect(Result.isFailure(parse({
        foo: { sounds: ['first'] },
        'minecraft:foo': { sounds: ['second'] },
      }))).toBe(true)
  })
})

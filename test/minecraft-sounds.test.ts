import { describe, expect, it } from 'vitest'
import {
  type MinecraftSoundEvent,
  mergeMinecraftSoundRegistries,
  minecraftSoundAssetUrl,
  minecraftSoundManifest,
  parseMinecraftSoundsJson,
  resolveMinecraftSound,
  selectMinecraftSoundVariant,
} from '../src/domain/minecraft-sounds'

const parse = (input: unknown) => parseMinecraftSoundsJson(input, { namespace: 'minecraft' })

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
    const registry = parse(BASE_SOUNDS)
    const event = registry.events['minecraft:block.break']
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
    const registry = parse({
      'block.high-range': {
        sounds: [{ name: 'block/high-range', volume: 2, pitch: 2.4 }],
      },
    })

    expect(registry.events['minecraft:block.high-range']?.sounds[0]).toMatchObject({
      volume: 2,
      pitch: 2.4,
    })
  })

  it('selects weighted variants deterministically and resolves event references', () => {
    const registry = parse(BASE_SOUNDS)
    const first = registry.events['minecraft:block.break']
    expect(first).toBeDefined()
    expect(selectMinecraftSoundVariant(first!, 0).name).toBe('minecraft:block/stone')
    expect(selectMinecraftSoundVariant(first!, 0.99).name).toBe('custom:rare')
    expect(selectMinecraftSoundVariant(first!, Number.NaN).name).toBe('minecraft:block/stone')

    const zeroWeightEvent: MinecraftSoundEvent = {
      id: 'minecraft:zero',
      replace: false,
      subtitle: null,
      sounds: [
        {
          name: 'minecraft:zero',
          type: 'sound',
          volume: 1,
          pitch: 1,
          weight: 0,
          stream: false,
          attenuationDistance: 16,
          preload: false,
        },
      ],
    }
    expect(selectMinecraftSoundVariant(zeroWeightEvent, 0).name).toBe('minecraft:zero')

    expect(resolveMinecraftSound(registry, 'minecraft:entity.echo')).toStrictEqual({
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
    const base = parse({
      'block.break': { subtitle: 'base.subtitle', sounds: ['block/stone'] },
      'block.place': { sounds: ['block/wood'] },
    })
    const overlay = parse({
      'block.break': { sounds: ['block/metal'] },
      'block.place': { replace: true, sounds: ['block/custom'] },
      'item.pickup': { sounds: ['item/pickup.ogg'] },
    })
    const merged = mergeMinecraftSoundRegistries(base, overlay)

    expect(merged.events['minecraft:block.break']).toMatchObject({
      subtitle: 'base.subtitle',
      sounds: [
        { name: 'minecraft:block/stone' },
        { name: 'minecraft:block/metal' },
      ],
    })
    expect(merged.events['minecraft:block.place']?.sounds).toStrictEqual([
      expect.objectContaining({ name: 'minecraft:block/custom' }),
    ])
    expect(mergeMinecraftSoundRegistries(base, parse({})).events['minecraft:block.place']).toBeDefined()
    expect(mergeMinecraftSoundRegistries(parse({}), overlay).events['minecraft:item.pickup']).toBeDefined()
    expect(Object.keys(minecraftSoundManifest(merged, '/packs/base/'))).toStrictEqual([
      'minecraft:block/custom',
      'minecraft:block/metal',
      'minecraft:block/stone',
      'minecraft:item/pickup',
    ])
    expect(minecraftSoundAssetUrl('custom:rare.ogg', '/packs/base/')).toBe(
      '/packs/base/assets/custom/sounds/rare.ogg',
    )
  })

  it('retains inherited preload and stream metadata when a sound is repeated', () => {
    const registry = parse({
      'sound.true-first': {
        sounds: [{ name: 'shared/true', preload: true, stream: true }],
      },
      'sound.true-second': { sounds: ['shared/true'] },
      'sound.false-first': { sounds: ['shared/false'] },
      'sound.false-second': { sounds: ['shared/false'] },
    })

    expect(minecraftSoundManifest(registry, '/packs')).toMatchObject({
      'minecraft:shared/false': { preload: false, stream: false },
      'minecraft:shared/true': { preload: true, stream: true },
    })
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
      expect(() => parse(input)).toThrowError(TypeError)
    }
    expect(() => parseMinecraftSoundsJson({}, { namespace: 'BadNamespace' })).toThrowError(TypeError)
    expect(() => minecraftSoundAssetUrl('bad:id:again', '/packs')).toThrowError(TypeError)
    expect(parse({ 'block.break': { sounds: [{ name: 'block/stone', volume: 0, pitch: 0 }] } }).events[
      'minecraft:block.break'
    ]?.sounds[0]).toMatchObject({ pitch: 0, volume: 0 })
  })

  it('reports missing and cyclic event references and empty events', () => {
    expect(parse({ 'entity.empty': { sounds: [] } }).events['minecraft:entity.empty']?.sounds).toStrictEqual([])

    const missing = parse({ 'entity.missing': { sounds: [{ name: 'entity.other', type: 'event' }] } })
    expect(() => resolveMinecraftSound(missing, 'minecraft:entity.missing')).toThrow('Unknown Minecraft sound event')

    const cyclic = parse({
      'entity.one': { sounds: [{ name: 'entity.two', type: 'event' }] },
      'entity.two': { sounds: [{ name: 'entity.one', type: 'event' }] },
    })
    expect(() => resolveMinecraftSound(cyclic, 'minecraft:entity.one')).toThrow(
      'Cyclic Minecraft sound event reference',
    )
    expect(() => minecraftSoundManifest(cyclic, '/packs')).toThrow('Cyclic Minecraft sound event reference')

    const inherited = parse({
      wrapper: { sounds: [{ name: 'target', type: 'event' }] },
      target: { sounds: [{ name: 'block/target', preload: true, stream: true }] },
    })
    expect(resolveMinecraftSound(inherited, 'minecraft:wrapper')).toMatchObject({
      soundId: 'minecraft:block/target',
      preload: true,
      stream: true,
    })
    expect(Object.keys(minecraftSoundManifest(inherited, '/packs'))).toStrictEqual(['minecraft:block/target'])
    expect(() =>
      selectMinecraftSoundVariant({
        id: 'minecraft:empty',
        replace: false,
        subtitle: null,
        sounds: [],
      }),
    ).toThrow(RangeError)
  })

  it('rejects sound event ids that normalize to the same resource id', () => {
    expect(() =>
      parse({
        foo: { sounds: ['first'] },
        'minecraft:foo': { sounds: ['second'] },
      }),
    ).toThrow('duplicate normalized sound event id minecraft:foo')
  })
})

/* oxlint-disable max-statements, no-magic-numbers */
import { describe, expect, it } from 'vitest'
import type { MinecraftSoundRegistry } from '../src/domain/minecraft-sounds-types.js'
import {
  parseMinecraftMobSoundVariantJson,
  parseMinecraftMobSoundVariantRegistry,
  parseMinecraftWolfSoundDefinition,
  resolveMinecraftMobSound,
  resolveMinecraftMobSoundEventId,
  resolveMinecraftMobSoundVariant,
  resolveMinecraftWolfSound,
  resolveMinecraftWolfSoundEventId,
  type MinecraftMobSoundBehavior,
  type MinecraftMobSoundVariantDefinition,
  type MinecraftMobSoundVariantKind,
  type MinecraftWolfSoundBehavior,
} from '../src/domain/minecraft-mob-sound-variants.js'

const catVariant = (prefix: string) => ({
  adult_sounds: {
    ambient_sound: `${prefix}/adult-ambient`,
    beg_for_food_sound: `${prefix}/adult-beg-for-food`,
    death_sound: `${prefix}/adult-death`,
    eat_sound: `${prefix}/adult-eat`,
    hiss_sound: `${prefix}/adult-hiss`,
    hurt_sound: `${prefix}/adult-hurt`,
    purr_sound: `${prefix}/adult-purr`,
    purreow_sound: `${prefix}/adult-purreow`,
    stray_ambient_sound: `${prefix}/adult-stray-ambient`,
  },
  baby_sounds: {
    ambient_sound: `${prefix}/baby-ambient`,
    beg_for_food_sound: `${prefix}/baby-beg-for-food`,
    death_sound: `${prefix}/baby-death`,
    eat_sound: `${prefix}/baby-eat`,
    hiss_sound: `${prefix}/baby-hiss`,
    hurt_sound: `${prefix}/baby-hurt`,
    purr_sound: `${prefix}/baby-purr`,
    purreow_sound: `${prefix}/baby-purreow`,
    stray_ambient_sound: `${prefix}/baby-stray-ambient`,
  },
})

const pigVariant = (prefix: string) => ({
  adult_sounds: {
    ambient_sound: `${prefix}/adult-ambient`,
    death_sound: `${prefix}/adult-death`,
    eat_sound: `${prefix}/adult-eat`,
    hurt_sound: `${prefix}/adult-hurt`,
    step_sound: `${prefix}/adult-step`,
  },
  baby_sounds: {
    ambient_sound: `${prefix}/baby-ambient`,
    death_sound: `${prefix}/baby-death`,
    eat_sound: `${prefix}/baby-eat`,
    hurt_sound: `${prefix}/baby-hurt`,
    step_sound: `${prefix}/baby-step`,
  },
})

const cowVariant = (prefix: string) => ({
  ambient_sound: `${prefix}/ambient`,
  death_sound: `${prefix}/death`,
  hurt_sound: `${prefix}/hurt`,
  step_sound: `${prefix}/step`,
})

const chickenVariant = (prefix: string) => ({
  adult_sounds: {
    ambient_sound: `${prefix}/adult-ambient`,
    death_sound: `${prefix}/adult-death`,
    hurt_sound: `${prefix}/adult-hurt`,
    step_sound: `${prefix}/adult-step`,
  },
  baby_sounds: {
    ambient_sound: `${prefix}/baby-ambient`,
    death_sound: `${prefix}/baby-death`,
    hurt_sound: `${prefix}/baby-hurt`,
    step_sound: `${prefix}/baby-step`,
  },
})

const wolfDefinition = (prefix: string) => ({
  adult_sounds: {
    ambient_sound: `${prefix}/adult-ambient`,
    death_sound: `${prefix}/adult-death`,
    growl_sound: `${prefix}/adult-growl`,
    hurt_sound: `${prefix}/adult-hurt`,
    pant_sound: `${prefix}/adult-pant`,
    whine_sound: `${prefix}/adult-whine`,
  },
  baby_sounds: {
    ambient_sound: `${prefix}/baby-ambient`,
    death_sound: `${prefix}/baby-death`,
    growl_sound: `${prefix}/baby-growl`,
    hurt_sound: `${prefix}/baby-hurt`,
    pant_sound: `${prefix}/baby-pant`,
    whine_sound: `${prefix}/baby-whine`,
  },
})

const makeSoundRegistry = (eventIds: readonly string[]): MinecraftSoundRegistry => ({
  events: Object.fromEntries(eventIds.map((eventId) => [
    eventId,
    {
      id: eventId,
      replace: false,
      subtitle: null,
      sounds: [{
        attenuationDistance: 16,
        name: `${eventId}/sample`,
        pitch: 1,
        preload: false,
        stream: false,
        type: 'sound',
        volume: 1,
        weight: 1,
      }],
    },
  ])),
})

describe('Minecraft mob sound variant data layer', () => {
  it('parses all official variant registry shapes and normalizes resource ids', () => {
    const cat = parseMinecraftMobSoundVariantRegistry({
      input: { classic: catVariant('cat') },
      kind: 'cat',
      namespace: 'minecraft',
    })
    const pig = parseMinecraftMobSoundVariantRegistry({
      input: { classic: pigVariant('pig') },
      kind: 'pig',
      namespace: 'minecraft',
    })
    const cow = parseMinecraftMobSoundVariantRegistry({
      input: { classic: cowVariant('cow') },
      kind: 'cow',
      namespace: 'minecraft',
    })
    const chicken = parseMinecraftMobSoundVariantRegistry({
      input: { classic: chickenVariant('chicken') },
      kind: 'chicken',
      namespace: 'minecraft',
    })
    const single = parseMinecraftMobSoundVariantJson({
      input: cowVariant('single'),
      kind: 'cow',
      namespace: 'custom',
      variantId: 'custom:single',
    })
    const wolf = parseMinecraftWolfSoundDefinition({ input: wolfDefinition('wolf'), namespace: 'minecraft' })

    expect(cat.kind).toBe('cat')
    expect(cat.variants['minecraft:classic']).toMatchObject({
      adultSounds: { ambientSound: 'minecraft:cat/adult-ambient', purreowSound: 'minecraft:cat/adult-purreow' },
      babySounds: { ambientSound: 'minecraft:cat/baby-ambient', strayAmbientSound: 'minecraft:cat/baby-stray-ambient' },
    })
    expect(pig.variants['minecraft:classic']).toMatchObject({
      adultSounds: { stepSound: 'minecraft:pig/adult-step' },
      babySounds: { eatSound: 'minecraft:pig/baby-eat' },
    })
    expect(cow.variants['minecraft:classic']).toMatchObject({
      sounds: { ambientSound: 'minecraft:cow/ambient', stepSound: 'minecraft:cow/step' },
    })
    expect(chicken.variants['minecraft:classic']).toMatchObject({
      adultSounds: { hurtSound: 'minecraft:chicken/adult-hurt' },
      babySounds: { deathSound: 'minecraft:chicken/baby-death' },
    })
    expect(single).toMatchObject({ id: 'custom:single', kind: 'cow', sounds: { deathSound: 'custom:single/death' } })
    expect(wolf).toMatchObject({
      adultSounds: { growlSound: 'minecraft:wolf/adult-growl' },
      babySounds: { whineSound: 'minecraft:wolf/baby-whine' },
    })
  })

  it('resolves age-specific and species-specific event ids', () => {
    const cat = parseMinecraftMobSoundVariantRegistry({
      input: { classic: catVariant('cat') },
      kind: 'cat',
      namespace: 'minecraft',
    }).variants['minecraft:classic']!
    const pig = parseMinecraftMobSoundVariantRegistry({
      input: { classic: pigVariant('pig') },
      kind: 'pig',
      namespace: 'minecraft',
    }).variants['minecraft:classic']!
    const cow = parseMinecraftMobSoundVariantRegistry({
      input: { classic: cowVariant('cow') },
      kind: 'cow',
      namespace: 'minecraft',
    }).variants['minecraft:classic']!
    const chicken = parseMinecraftMobSoundVariantRegistry({
      input: { classic: chickenVariant('chicken') },
      kind: 'chicken',
      namespace: 'minecraft',
    }).variants['minecraft:classic']!
    const catBehaviors: readonly [MinecraftMobSoundBehavior, string][] = [
      ['ambient', 'ambientSound'],
      ['strayAmbient', 'strayAmbientSound'],
      ['hiss', 'hissSound'],
      ['hurt', 'hurtSound'],
      ['death', 'deathSound'],
      ['eat', 'eatSound'],
      ['begForFood', 'begForFoodSound'],
      ['purr', 'purrSound'],
      ['purreow', 'purreowSound'],
    ]

    for (const [behavior, field] of catBehaviors) {
      expect(resolveMinecraftMobSoundEventId(cat, behavior)).toBe(`minecraft:cat/adult-${field.replace('Sound', '').replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`)
    }
    expect(resolveMinecraftMobSoundEventId(cat, 'ambient', true)).toBe('minecraft:cat/baby-ambient')
    expect(resolveMinecraftMobSoundEventId(pig, 'step', true)).toBe('minecraft:pig/baby-step')
    expect(resolveMinecraftMobSoundEventId(cow, 'step', true)).toBe('minecraft:cow/step')
    expect(resolveMinecraftMobSoundEventId(chicken, 'death', true)).toBe('minecraft:chicken/baby-death')
    expect(() => resolveMinecraftMobSoundEventId(cow, 'purr')).toThrow('does not define purr')
  })

  it('resolves selected variants through sounds.json and rejects unknown variants', () => {
    const variants = parseMinecraftMobSoundVariantRegistry({
      input: { classic: catVariant('cat') },
      kind: 'cat',
      namespace: 'minecraft',
    })
    const definition = variants.variants['minecraft:classic']!
    const eventIds = [
      'minecraft:cat/adult-ambient',
      'minecraft:cat/baby-ambient',
      'minecraft:cat/adult-purr',
    ] as const
    const registry = makeSoundRegistry(eventIds)

    expect(resolveMinecraftMobSound({ behavior: 'ambient', definition, registry })).toMatchObject({
      eventId: 'minecraft:cat/adult-ambient',
      soundId: 'minecraft:cat/adult-ambient/sample',
    })
    expect(resolveMinecraftMobSound({
      behavior: 'ambient',
      definition,
      options: { isBaby: true, random: 0.75 },
      registry,
    })).toMatchObject({
      eventId: 'minecraft:cat/baby-ambient',
      soundId: 'minecraft:cat/baby-ambient/sample',
    })
    expect(resolveMinecraftMobSoundVariant({
      behavior: 'purr',
      registry,
      variantId: 'minecraft:classic',
      variants,
    }).eventId).toBe('minecraft:cat/adult-purr')
    expect(() => resolveMinecraftMobSoundVariant({
      behavior: 'ambient',
      registry,
      variantId: 'missing',
      variants,
    })).toThrow('Unknown Minecraft cat sound variant')
    const nullDefinitionVariants = {
      ...variants,
      variants: { ...variants.variants, null: null as unknown as MinecraftMobSoundVariantDefinition },
    }
    expect(() => resolveMinecraftMobSoundVariant({
      behavior: 'ambient',
      registry,
      variantId: 'null',
      variants: nullDefinitionVariants,
    })).toThrow('Unknown Minecraft cat sound variant')
  })

  it('resolves every wolf sound behavior for adult and baby definitions', () => {
    const definition = parseMinecraftWolfSoundDefinition({ input: wolfDefinition('wolf'), namespace: 'minecraft' })
    const behaviors: readonly [MinecraftWolfSoundBehavior, string][] = [
      ['ambient', 'ambient'],
      ['death', 'death'],
      ['growl', 'growl'],
      ['hurt', 'hurt'],
      ['pant', 'pant'],
      ['whine', 'whine'],
    ]
    for (const [behavior, name] of behaviors) {
      expect(resolveMinecraftWolfSoundEventId(definition, behavior)).toBe(`minecraft:wolf/adult-${name}`)
      expect(resolveMinecraftWolfSoundEventId(definition, behavior, true)).toBe(`minecraft:wolf/baby-${name}`)
    }
    const registry = makeSoundRegistry(['minecraft:wolf/adult-pant', 'minecraft:wolf/baby-pant'])
    expect(resolveMinecraftWolfSound({
      behavior: 'pant',
      definition,
      registry,
    })).toMatchObject({ eventId: 'minecraft:wolf/adult-pant' })
    expect(resolveMinecraftWolfSound({
      behavior: 'pant',
      definition,
      options: { isBaby: true, random: 0.5 },
      registry,
    })).toMatchObject({ eventId: 'minecraft:wolf/baby-pant' })
  })

  it('rejects malformed registries, definitions, ids, and kinds at the data boundary', () => {
    expect(() => parseMinecraftMobSoundVariantRegistry({ input: null, kind: 'cat', namespace: 'minecraft' })).toThrow(TypeError)
    expect(() => parseMinecraftMobSoundVariantRegistry({ input: [], kind: 'cat', namespace: 'minecraft' })).toThrow(TypeError)
    expect(() => parseMinecraftMobSoundVariantRegistry({ input: 'bad', kind: 'cat', namespace: 'minecraft' })).toThrow(TypeError)
    expect(() => parseMinecraftMobSoundVariantRegistry({ input: {}, kind: 'horse' as MinecraftMobSoundVariantKind, namespace: 'minecraft' })).toThrow(TypeError)
    expect(() => parseMinecraftMobSoundVariantRegistry({ input: {}, kind: 'cat', namespace: 'BadNamespace' })).toThrow(TypeError)
    expect(() => parseMinecraftMobSoundVariantJson({ input: null, kind: 'cat', namespace: 'minecraft', variantId: 'classic' })).toThrow(TypeError)
    expect(() => parseMinecraftMobSoundVariantJson({ input: catVariant('cat'), kind: 'cat', namespace: 'minecraft', variantId: 'bad id' })).toThrow(TypeError)
    expect(() => parseMinecraftMobSoundVariantRegistry({
      input: { classic: { ...catVariant('cat'), unknown: true } },
      kind: 'cat',
      namespace: 'minecraft',
    })).toThrow(TypeError)
    expect(() => parseMinecraftMobSoundVariantRegistry({
      input: { classic: { adult_sounds: {}, baby_sounds: {} } },
      kind: 'cat',
      namespace: 'minecraft',
    })).toThrow(TypeError)
    expect(() => parseMinecraftMobSoundVariantRegistry({
      input: { classic: cowVariant('cow'), 'minecraft:classic': cowVariant('cow') },
      kind: 'cow',
      namespace: 'minecraft',
    })).toThrow('duplicate normalized variant id')
    expect(() => parseMinecraftWolfSoundDefinition({ input: null, namespace: 'minecraft' })).toThrow(TypeError)
    expect(() => parseMinecraftWolfSoundDefinition({ input: { ...wolfDefinition('wolf'), extra: true }, namespace: 'minecraft' })).toThrow(TypeError)
    expect(() => parseMinecraftWolfSoundDefinition({ input: { adult_sounds: {}, baby_sounds: {} }, namespace: 'minecraft' })).toThrow(TypeError)
    expect(() => parseMinecraftWolfSoundDefinition({ input: wolfDefinition('wolf'), namespace: 'BadNamespace' })).toThrow(TypeError)
  })
})


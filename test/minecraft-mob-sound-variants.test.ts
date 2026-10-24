/* oxlint-disable max-statements, no-magic-numbers */
import { describe, expect, it } from 'vitest'
import { Result } from 'effect'
import {
  AudioDistance,
  AudioGain,
  AudioPlaybackRate,
  AudioWeight,
  MinecraftMobSoundVariantId,
  MinecraftSoundEventId,
  MinecraftSoundNamespace,
  MinecraftSoundResourceId,
} from '../src/domain/audio-brands.js'
import type { MinecraftSoundEvent, MinecraftSoundRegistry } from '../src/domain/minecraft-sounds-types.js'
import {
  parseMinecraftMobSoundVariantJson as parseVariantJsonResult,
  parseMinecraftMobSoundVariantRegistry as parseVariantRegistryResult,
  parseMinecraftWolfSoundDefinition as parseWolfSoundDefinitionResult,
  resolveMinecraftMobSound,
  resolveMinecraftMobSoundEventId,
  resolveMinecraftMobSoundVariant,
  resolveMinecraftWolfSound,
  resolveMinecraftWolfSoundEventId,
  type MinecraftMobSoundBehavior,
  type MinecraftMobSoundVariantDefinition,
  type MinecraftWolfSoundBehavior,
} from '../src/domain/minecraft-mob-sound-variants.js'

const success = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) {
    throw new Error('expected a successful result')
  }
  return result.success
}

const parseMinecraftMobSoundVariantRegistry = (options: { input: unknown; kind: unknown; namespace?: string }) =>
  success(parseVariantRegistryResult({
    ...options,
    namespace: MinecraftSoundNamespace(options.namespace ?? 'minecraft'),
  }))

const parseMinecraftMobSoundVariantJson = (options: { input: unknown; kind: unknown; namespace?: string; variantId: string }) =>
  success(parseVariantJsonResult({
    ...options,
    namespace: MinecraftSoundNamespace(options.namespace ?? 'minecraft'),
    variantId: MinecraftMobSoundVariantId(options.variantId),
  }))

const parseMinecraftWolfSoundDefinition = (options: { input: unknown; namespace?: string }) =>
  success(parseWolfSoundDefinitionResult({
    ...options,
    namespace: MinecraftSoundNamespace(options.namespace ?? 'minecraft'),
  }))

const variantOrThrow = (
  variants: ReadonlyMap<MinecraftMobSoundVariantId, MinecraftMobSoundVariantDefinition>,
): MinecraftMobSoundVariantDefinition => {
  const variant = variants.get(MinecraftMobSoundVariantId('minecraft:classic'))
  if (variant === undefined) {
    throw new Error('expected classic variant')
  }
  return variant
}

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
  events: new Map<MinecraftSoundEventId, MinecraftSoundEvent>(eventIds.map((rawEventId) => {
    const eventId = MinecraftSoundEventId(rawEventId)
    const event: MinecraftSoundEvent = {
      id: eventId,
      replace: false,
      subtitle: null,
      sounds: [{
        attenuationDistance: AudioDistance(16),
        name: MinecraftSoundResourceId(`${eventId}/sample`),
        pitch: AudioPlaybackRate(1),
        preload: false,
        stream: false,
        type: 'sound',
        volume: AudioGain(1),
        weight: AudioWeight(1),
      }],
    }
    return [eventId, event]
  })),
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
    expect(cat.variants.get(MinecraftMobSoundVariantId('minecraft:classic'))).toMatchObject({
      adultSounds: { ambientSound: 'minecraft:cat/adult-ambient', purreowSound: 'minecraft:cat/adult-purreow' },
      babySounds: { ambientSound: 'minecraft:cat/baby-ambient', strayAmbientSound: 'minecraft:cat/baby-stray-ambient' },
    })
    expect(pig.variants.get(MinecraftMobSoundVariantId('minecraft:classic'))).toMatchObject({
      adultSounds: { stepSound: 'minecraft:pig/adult-step' },
      babySounds: { eatSound: 'minecraft:pig/baby-eat' },
    })
    expect(cow.variants.get(MinecraftMobSoundVariantId('minecraft:classic'))).toMatchObject({
      sounds: { ambientSound: 'minecraft:cow/ambient', stepSound: 'minecraft:cow/step' },
    })
    expect(chicken.variants.get(MinecraftMobSoundVariantId('minecraft:classic'))).toMatchObject({
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
    expect(() => variantOrThrow(new Map<MinecraftMobSoundVariantId, MinecraftMobSoundVariantDefinition>()))
      .toThrow('expected classic variant')
    const catRegistry = parseMinecraftMobSoundVariantRegistry({
      input: { classic: catVariant('cat') },
      kind: 'cat',
      namespace: 'minecraft',
    })
    const cat = variantOrThrow(catRegistry.variants)
    const pigRegistry = parseMinecraftMobSoundVariantRegistry({
      input: { classic: pigVariant('pig') },
      kind: 'pig',
      namespace: 'minecraft',
    })
    const pig = variantOrThrow(pigRegistry.variants)
    const cowRegistry = parseMinecraftMobSoundVariantRegistry({
      input: { classic: cowVariant('cow') },
      kind: 'cow',
      namespace: 'minecraft',
    })
    const cow = variantOrThrow(cowRegistry.variants)
    const chickenRegistry = parseMinecraftMobSoundVariantRegistry({
      input: { classic: chickenVariant('chicken') },
      kind: 'chicken',
      namespace: 'minecraft',
    })
    const chicken = variantOrThrow(chickenRegistry.variants)
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
      expect(success(resolveMinecraftMobSoundEventId(cat, behavior))).toBe(`minecraft:cat/adult-${field.replace('Sound', '').replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`)
    }
    expect(success(resolveMinecraftMobSoundEventId(cat, 'ambient', true))).toBe('minecraft:cat/baby-ambient')
    expect(success(resolveMinecraftMobSoundEventId(pig, 'step', true))).toBe('minecraft:pig/baby-step')
    expect(success(resolveMinecraftMobSoundEventId(cow, 'step', true))).toBe('minecraft:cow/step')
    expect(success(resolveMinecraftMobSoundEventId(chicken, 'death', true))).toBe('minecraft:chicken/baby-death')
    const missingBehavior = resolveMinecraftMobSoundEventId(cow, 'purr')
    expect(Result.isFailure(missingBehavior)).toBe(true)
  })

  it('resolves selected variants through sounds.json and rejects unknown variants', () => {
    const variants = parseMinecraftMobSoundVariantRegistry({
      input: { classic: catVariant('cat') },
      kind: 'cat',
      namespace: 'minecraft',
    })
    const definition = variants.variants.get(MinecraftMobSoundVariantId('minecraft:classic'))
    if (definition === undefined) {
      throw new Error('expected classic variant')
    }
    const eventIds = [
      'minecraft:cat/adult-ambient',
      'minecraft:cat/baby-ambient',
      'minecraft:cat/adult-purr',
    ] as const
    const registry = makeSoundRegistry(eventIds)

    expect(success(resolveMinecraftMobSound({ behavior: 'ambient', definition, registry }))).toMatchObject({
      eventId: 'minecraft:cat/adult-ambient',
      soundId: 'minecraft:cat/adult-ambient/sample',
    })
    expect(success(resolveMinecraftMobSound({
      behavior: 'ambient',
      definition,
      options: { isBaby: true, random: 0.75 },
      registry,
    }))).toMatchObject({
      eventId: 'minecraft:cat/baby-ambient',
      soundId: 'minecraft:cat/baby-ambient/sample',
    })
    expect(success(resolveMinecraftMobSoundVariant({
      behavior: 'purr',
      registry,
      variantId: MinecraftMobSoundVariantId('minecraft:classic'),
      variants,
    })).eventId).toBe('minecraft:cat/adult-purr')
    expect(Result.isFailure(resolveMinecraftMobSoundVariant({
      behavior: 'ambient',
      registry,
      variantId: MinecraftMobSoundVariantId('missing'),
      variants,
    }))).toBe(true)
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
      expect(success(resolveMinecraftWolfSoundEventId(definition, behavior))).toBe(`minecraft:wolf/adult-${name}`)
      expect(success(resolveMinecraftWolfSoundEventId(definition, behavior, true))).toBe(`minecraft:wolf/baby-${name}`)
    }
    const registry = makeSoundRegistry(['minecraft:wolf/adult-pant', 'minecraft:wolf/baby-pant'])
    expect(success(resolveMinecraftWolfSound({
      behavior: 'pant',
      definition,
      registry,
    }))).toMatchObject({ eventId: 'minecraft:wolf/adult-pant' })
    expect(success(resolveMinecraftWolfSound({
      behavior: 'pant',
      definition,
      options: { isBaby: true, random: 0.5 },
      registry,
    }))).toMatchObject({ eventId: 'minecraft:wolf/baby-pant' })
  })

  it('rejects malformed registries, definitions, ids, and kinds at the data boundary', () => {
    const namespace = MinecraftSoundNamespace('minecraft')
    const invalidRegistry = (input: unknown, kind: unknown) =>
      parseVariantRegistryResult({ input, kind, namespace })
    const invalidWolfDefinition = (input: unknown) => parseWolfSoundDefinitionResult({ input, namespace })
    expect(Result.isFailure(invalidRegistry({ classic: { adult_sounds: {} } }, 'cat'))).toBe(true)
    expect(Result.isFailure(invalidRegistry(null, 'cat'))).toBe(true)
    expect(Result.isFailure(invalidRegistry([], 'cat'))).toBe(true)
    expect(Result.isFailure(invalidRegistry('bad', 'cat'))).toBe(true)
    expect(Result.isFailure(invalidRegistry({}, 'horse'))).toBe(true)
    expect(Result.isFailure(Reflect.apply(parseVariantRegistryResult, undefined, [{ input: {}, kind: 'cat', namespace: 'BadNamespace' }]))).toBe(true)
    expect(Result.isFailure(parseVariantJsonResult({ input: null, kind: 'cat', namespace, variantId: MinecraftMobSoundVariantId('classic') }))).toBe(true)
    expect(Result.isFailure(parseVariantJsonResult({ input: catVariant('cat'), kind: 'cat', namespace, variantId: MinecraftMobSoundVariantId('bad id') }))).toBe(true)
    const invalidSoundId = parseVariantJsonResult({
      input: { ...cowVariant('cow'), ambient_sound: 'BadNamespace:ambient' },
      kind: 'cow',
      namespace,
      variantId: MinecraftMobSoundVariantId('classic'),
    })
    expect(Result.isFailure(invalidSoundId)).toBe(true)
    if (Result.isFailure(invalidSoundId)) {
      expect(invalidSoundId.failure).toMatchObject({
        _tag: 'MinecraftMobSoundVariantParseFailure',
        path: '$.ambient_sound',
        message: 'contains an invalid resource namespace',
      })
    }
    expect(Result.isFailure(invalidRegistry({ classic: { ...catVariant('cat'), unknown: true } }, 'cat'))).toBe(true)
    expect(Result.isFailure(invalidRegistry({ classic: { adult_sounds: {}, baby_sounds: {} } }, 'cat'))).toBe(true)
    const duplicate = invalidRegistry({ classic: cowVariant('cow'), 'minecraft:classic': cowVariant('cow') }, 'cow')
    expect(Result.isFailure(duplicate)).toBe(true)
    if (Result.isFailure(duplicate)) {
      expect(duplicate.failure.message).toContain('duplicate normalized variant id')
    }
    expect(Result.isFailure(invalidWolfDefinition(null))).toBe(true)
    expect(Result.isFailure(invalidWolfDefinition({ ...wolfDefinition('wolf'), extra: true }))).toBe(true)
    expect(Result.isFailure(invalidWolfDefinition({ adult_sounds: {}, baby_sounds: {} }))).toBe(true)
    expect(Result.isFailure(Reflect.apply(parseWolfSoundDefinitionResult, undefined, [{ input: wolfDefinition('wolf'), namespace: 'BadNamespace' }]))).toBe(true)
  })
})

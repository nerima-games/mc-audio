/* oxlint-disable max-statements, no-magic-numbers */
import { AIR_BLOCK_ID, blockIdOf } from '@nerima-games/mc-kernel/domain/block-registry'
import { Option, Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { AudioVolume } from '../src/domain/audio-brands.js'
import {
  canPlayMinecraftFireflyBushIdleSounds,
  MINECRAFT_AUDIO_COMPONENT_NAMES,
  normalizeMinecraftAudioComponent,
  parseMinecraftAudioComponent,
} from '../src/domain/minecraft-audio.js'

const success = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) {
    throw new Error('expected a successful result')
  }
  return result.success
}

const VALID_COMPONENT = {
  'minecraft:audio/ambient_sounds': {
    additions: [{ sound: 'minecraft:ambient.addition', tick_chance: 1 }],
    loop: 'minecraft:ambient.loop',
    mood: {
      block_search_extent: 8,
      offset: 0,
      sound: 'minecraft:ambient.mood',
      tick_delay: 80,
    },
  },
  'minecraft:audio/background_music': {
    creative: {
      max_delay: 24,
      min_delay: 12,
      replace_current_music: true,
      sound: 'minecraft:music.creative',
    },
    default: {
      max_delay: 24,
      min_delay: 12,
      sound: 'minecraft:music.game',
    },
    underwater: {
      max_delay: 24,
      min_delay: 12,
      sound: 'minecraft:music.under_water',
    },
  },
  'minecraft:audio/firefly_bush_sounds': true,
  'minecraft:audio/music_volume': 0.8,
} as const

describe('Minecraft audio component', () => {
  it('normalizes an omitted or empty component to explicit null values', () => {
    const empty = {
      ambientSounds: null,
      backgroundMusic: null,
      fireflyBushSounds: null,
      musicVolume: null,
    }
    expect(success(normalizeMinecraftAudioComponent())).toStrictEqual(empty)
    expect(success(normalizeMinecraftAudioComponent(null))).toStrictEqual(empty)
    expect(success(normalizeMinecraftAudioComponent({}))).toStrictEqual(empty)
    expect(MINECRAFT_AUDIO_COMPONENT_NAMES).toStrictEqual([
      'minecraft:audio/ambient_sounds',
      'minecraft:audio/background_music',
      'minecraft:audio/firefly_bush_sounds',
      'minecraft:audio/music_volume',
    ])
  })

  it('normalizes official ambient, background music, firefly, and volume fields', () => {
    expect(success(parseMinecraftAudioComponent(VALID_COMPONENT))).toStrictEqual({
      ambientSounds: {
        additions: [{ sound: 'minecraft:ambient.addition', tick_chance: 1 }],
        loop: 'minecraft:ambient.loop',
        mood: {
          block_search_extent: 8,
          offset: 0,
          sound: 'minecraft:ambient.mood',
          tick_delay: 80,
        },
      },
      backgroundMusic: {
        creative: {
          max_delay: 24,
          min_delay: 12,
          replace_current_music: true,
          sound: 'minecraft:music.creative',
        },
        default: {
          max_delay: 24,
          min_delay: 12,
          replace_current_music: false,
          sound: 'minecraft:music.game',
        },
        underwater: {
          max_delay: 24,
          min_delay: 12,
          replace_current_music: false,
          sound: 'minecraft:music.under_water',
        },
      },
      fireflyBushSounds: true,
      musicVolume: AudioVolume(0.8),
    })
    expect(
      success(parseMinecraftAudioComponent({
        'minecraft:audio/ambient_sounds': {},
        'minecraft:audio/background_music': {},
        'minecraft:audio/music_volume': 0,
      })),
    ).toStrictEqual({
      ambientSounds: { additions: [], loop: null, mood: null },
      backgroundMusic: {},
      fireflyBushSounds: null,
      musicVolume: AudioVolume(0),
    })
    expect(
      success(parseMinecraftAudioComponent({
        'minecraft:audio/background_music': { default: {} },
      })),
    ).toStrictEqual({
      ambientSounds: null,
      backgroundMusic: { default: null },
      fireflyBushSounds: null,
      musicVolume: null,
    })
  })

  it('accepts the upper boundary for normalized music volume', () => {
    expect(success(normalizeMinecraftAudioComponent({ 'minecraft:audio/music_volume': 1 }))).toStrictEqual({
      ambientSounds: null,
      backgroundMusic: null,
      fireflyBushSounds: null,
      musicVolume: AudioVolume(1),
    })
  })

  it('normalizes explicit firefly false and applies the opaque-block gate', () => {
    expect(
      success(parseMinecraftAudioComponent({ 'minecraft:audio/firefly_bush_sounds': false })),
    ).toStrictEqual({
      ambientSounds: null,
      backgroundMusic: null,
      fireflyBushSounds: false,
      musicVolume: null,
    })
    expect(
      success(canPlayMinecraftFireflyBushIdleSounds({ fireflyBushSounds: true, belowOpaqueBlock: false })),
    ).toBe(true)
    expect(
      success(canPlayMinecraftFireflyBushIdleSounds({ fireflyBushSounds: true, belowOpaqueBlock: true })),
    ).toBe(false)
    expect(
      success(canPlayMinecraftFireflyBushIdleSounds({ fireflyBushSounds: false, belowOpaqueBlock: false })),
    ).toBe(false)
    expect(
      success(canPlayMinecraftFireflyBushIdleSounds({ fireflyBushSounds: null, belowOpaqueBlock: false })),
    ).toBe(false)
  })

  it('uses mc-kernel block light transmission when a block id is provided', () => {
    expect(
      success(canPlayMinecraftFireflyBushIdleSounds({
        belowBlockId: AIR_BLOCK_ID,
        belowOpaqueBlock: true,
        fireflyBushSounds: true,
      })),
    ).toBe(true)
    expect(
      success(canPlayMinecraftFireflyBushIdleSounds({
        belowBlockId: Option.getOrThrow(blockIdOf('stone')),
        belowOpaqueBlock: false,
        fireflyBushSounds: true,
      })),
    ).toBe(false)
    expect(
      success(canPlayMinecraftFireflyBushIdleSounds({
        belowOpaqueBlock: true,
        fireflyBushSounds: true,
      })),
    ).toBe(false)
    expect(Result.isFailure(Reflect.apply(canPlayMinecraftFireflyBushIdleSounds, undefined, [{
      belowBlockId: 999,
      belowOpaqueBlock: false,
      fireflyBushSounds: true,
    }]))).toBe(true)
  })

  it('rejects malformed component, background, ambient, firefly, and volume values', () => {
    for (const invalid of [
      null,
      [],
      'audio',
      { 'minecraft:audio/unknown': {} },
      { 'minecraft:audio/background_music': [] },
      { 'minecraft:audio/background_music': { unknown: {} } },
      { 'minecraft:audio/background_music': { default: { unknown: true } } },
      { 'minecraft:audio/background_music': { default: [] } },
      { 'minecraft:audio/ambient_sounds': [] },
      { 'minecraft:audio/ambient_sounds': null },
      { 'minecraft:audio/firefly_bush_sounds': 'true' },
      { 'minecraft:audio/firefly_bush_sounds': null },
      { 'minecraft:audio/music_volume': '0.8' },
      { 'minecraft:audio/music_volume': Number.NaN },
      { 'minecraft:audio/music_volume': Number.POSITIVE_INFINITY },
      { 'minecraft:audio/music_volume': -0.1 },
      { 'minecraft:audio/music_volume': 1.1 },
    ]) {
      expect(Result.isFailure(parseMinecraftAudioComponent(invalid))).toBe(true)
    }
  })
})

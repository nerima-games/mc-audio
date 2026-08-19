/* oxlint-disable max-statements, no-magic-numbers */
import { AIR_BLOCK_ID, blockIdOf, type BlockId } from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import {
  canPlayMinecraftFireflyBushIdleSounds,
  MINECRAFT_AUDIO_COMPONENT_NAMES,
  normalizeMinecraftAudioComponent,
  parseMinecraftAudioComponent,
} from '../src/domain/minecraft-audio.js'

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
    expect(normalizeMinecraftAudioComponent()).toStrictEqual(empty)
    expect(normalizeMinecraftAudioComponent(null)).toStrictEqual(empty)
    expect(normalizeMinecraftAudioComponent({})).toStrictEqual(empty)
    expect(MINECRAFT_AUDIO_COMPONENT_NAMES).toStrictEqual([
      'minecraft:audio/ambient_sounds',
      'minecraft:audio/background_music',
      'minecraft:audio/firefly_bush_sounds',
      'minecraft:audio/music_volume',
    ])
  })

  it('normalizes official ambient, background music, firefly, and volume fields', () => {
    expect(parseMinecraftAudioComponent(VALID_COMPONENT)).toStrictEqual({
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
      musicVolume: 0.8,
    })
    expect(
      parseMinecraftAudioComponent({
        'minecraft:audio/ambient_sounds': {},
        'minecraft:audio/background_music': {},
        'minecraft:audio/music_volume': 0,
      }),
    ).toStrictEqual({
      ambientSounds: { additions: [], loop: null, mood: null },
      backgroundMusic: {},
      fireflyBushSounds: null,
      musicVolume: 0,
    })
    expect(
      parseMinecraftAudioComponent({
        'minecraft:audio/background_music': { default: {} },
      }),
    ).toStrictEqual({
      ambientSounds: null,
      backgroundMusic: { default: null },
      fireflyBushSounds: null,
      musicVolume: null,
    })
  })

  it('normalizes explicit firefly false and applies the opaque-block gate', () => {
    expect(
      parseMinecraftAudioComponent({ 'minecraft:audio/firefly_bush_sounds': false }),
    ).toStrictEqual({
      ambientSounds: null,
      backgroundMusic: null,
      fireflyBushSounds: false,
      musicVolume: null,
    })
    expect(
      canPlayMinecraftFireflyBushIdleSounds({ fireflyBushSounds: true, belowOpaqueBlock: false }),
    ).toBe(true)
    expect(
      canPlayMinecraftFireflyBushIdleSounds({ fireflyBushSounds: true, belowOpaqueBlock: true }),
    ).toBe(false)
    expect(
      canPlayMinecraftFireflyBushIdleSounds({ fireflyBushSounds: false, belowOpaqueBlock: false }),
    ).toBe(false)
    expect(
      canPlayMinecraftFireflyBushIdleSounds({ fireflyBushSounds: null, belowOpaqueBlock: false }),
    ).toBe(false)
  })

  it('uses mc-kernel block light transmission when a block id is provided', () => {
    expect(
      canPlayMinecraftFireflyBushIdleSounds({
        belowBlockId: AIR_BLOCK_ID,
        belowOpaqueBlock: true,
        fireflyBushSounds: true,
      }),
    ).toBe(true)
    expect(
      canPlayMinecraftFireflyBushIdleSounds({
        belowBlockId: blockIdOf('stone'),
        belowOpaqueBlock: false,
        fireflyBushSounds: true,
      }),
    ).toBe(false)
    expect(() =>
      canPlayMinecraftFireflyBushIdleSounds({
        belowBlockId: 999 as BlockId,
        belowOpaqueBlock: false,
        fireflyBushSounds: true,
      }),
    ).toThrow(RangeError)
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
      expect(() => parseMinecraftAudioComponent(invalid)).toThrow()
    }
  })
})

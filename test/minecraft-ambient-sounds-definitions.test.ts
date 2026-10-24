/* oxlint-disable max-statements, no-magic-numbers */
import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import { normalizeMinecraftAmbientSoundsDefinition } from '../src/domain/minecraft-ambient-sounds.js'
import { asDefinition } from './minecraft-ambient-sounds-support.js'

const success = (result: ReturnType<typeof normalizeMinecraftAmbientSoundsDefinition>) => {
  if (Result.isFailure(result)) {
    throw result.failure
  }
  return result.success
}

describe('Minecraft ambient sound definitions', () => {
  it('normalizes the official defaults and fields', () => {
    expect(success(normalizeMinecraftAmbientSoundsDefinition())).toStrictEqual({
      additions: [],
      loop: null,
      mood: null,
    })
    expect(success(normalizeMinecraftAmbientSoundsDefinition(null))).toStrictEqual({
      additions: [],
      loop: null,
      mood: null,
    })
    expect(
      success(normalizeMinecraftAmbientSoundsDefinition(
        asDefinition({
          additions: [],
          loop: 'minecraft:ambient.loop',
          mood: {
            block_search_extent: 8,
            offset: 0.5,
            sound: 'minecraft:ambient.mood',
            tick_delay: 80,
          },
        }),
      )),
    ).toStrictEqual({
      additions: [],
      loop: 'minecraft:ambient.loop',
      mood: {
        block_search_extent: 8,
        offset: 0.5,
        sound: 'minecraft:ambient.mood',
        tick_delay: 80,
      },
    })
    expect(
      success(normalizeMinecraftAmbientSoundsDefinition(
        asDefinition({ additions: null, loop: null, mood: null }),
      )),
    ).toStrictEqual({ additions: [], loop: null, mood: null })
  })

  it('accepts the boundary values supported by ambient sound brands', () => {
    expect(success(normalizeMinecraftAmbientSoundsDefinition(
      asDefinition({
        additions: [
          { sound: 'minecraft:ambient.silent', tick_chance: 0 },
          { sound: 'minecraft:ambient.certain', tick_chance: 1 },
        ],
        mood: {
          block_search_extent: 0,
          offset: -1.5,
          sound: 'minecraft:ambient.mood',
          tick_delay: 1,
        },
      }),
    ))).toStrictEqual({
      additions: [
        { sound: 'minecraft:ambient.silent', tick_chance: 0 },
        { sound: 'minecraft:ambient.certain', tick_chance: 1 },
      ],
      loop: null,
      mood: {
        block_search_extent: 0,
        offset: -1.5,
        sound: 'minecraft:ambient.mood',
        tick_delay: 1,
      },
    })
  })

  it('rejects malformed loop, mood, addition, and probability fields', () => {
    for (const invalid of [
      asDefinition([]),
      asDefinition({ unknown: true }),
      asDefinition({ loop: 1 }),
      asDefinition({ loop: '' }),
      asDefinition({ mood: [] }),
      asDefinition({ mood: 1 }),
      asDefinition({ mood: {} }),
      asDefinition({
        mood: {
          block_search_extent: 0,
          offset: 0,
          sound: 'mood',
          tick_delay: 1,
          unknown: true,
        },
      }),
      asDefinition({ mood: { block_search_extent: 0, offset: 0, sound: '', tick_delay: 1 } }),
      asDefinition({ mood: { block_search_extent: 0, offset: 0, sound: 'mood', tick_delay: '1' } }),
      asDefinition({ mood: { block_search_extent: 0, offset: 0, sound: 'mood', tick_delay: 0 } }),
      asDefinition({ mood: { block_search_extent: 0, offset: 0, sound: 'mood', tick_delay: 0.5 } }),
      asDefinition({ mood: { block_search_extent: -1, offset: 0, sound: 'mood', tick_delay: 1 } }),
      asDefinition({ mood: { block_search_extent: 0.5, offset: 0, sound: 'mood', tick_delay: 1 } }),
      asDefinition({ mood: { block_search_extent: 0, offset: '0', sound: 'mood', tick_delay: 1 } }),
      asDefinition({ mood: { block_search_extent: 0, offset: Number.NaN, sound: 'mood', tick_delay: 1 } }),
      asDefinition({ additions: 1 }),
      asDefinition({ additions: [1] }),
      asDefinition({ additions: [{}] }),
      asDefinition({ additions: [[]] }),
      asDefinition({ additions: [{ sound: 'addition', tick_chance: 1, unknown: true }] }),
      asDefinition({ additions: [{ sound: 'addition', tick_chance: '0' }] }),
      asDefinition({ additions: [{ sound: 'addition', tick_chance: Number.NaN }] }),
      asDefinition({ additions: [{ sound: 'addition', tick_chance: -0.1 }] }),
      asDefinition({ additions: [{ sound: 'addition', tick_chance: 1.1 }] }),
    ]) {
      expect(Result.isFailure(normalizeMinecraftAmbientSoundsDefinition(invalid))).toBe(true)
    }
  })
})

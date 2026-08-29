import { describe, expect, it } from 'vitest'

import {
  MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_GROUPS,
  MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_IDS,
  MINECRAFT_26_3_SNAPSHOT_9_SOUNDS_JSON,
  createMinecraft26_3Snapshot9SoundRegistry,
  missingMinecraft26_3Snapshot9SoundEvents,
} from '../src/domain/minecraft-26-3-snapshot-9-sounds.js'
import { parseMinecraftSoundsJson } from '../src/domain/minecraft-sounds-parser.js'

const completeSoundsJson = (): Record<string, { sounds: string[] }> =>
  Object.fromEntries(
    MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_IDS.map((eventId) => [eventId, { sounds: [eventId] }]),
  )

describe('Minecraft 26.3 Snapshot 9 sound event catalog', () => {
  it('contains the complete snapshot event catalog', () => {
    const groupEventIds = Object.values(MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_GROUPS).flat()

    expect(Object.keys(MINECRAFT_26_3_SNAPSHOT_9_SOUNDS_JSON)).toHaveLength(1991)
    expect(MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_IDS).toHaveLength(
      Object.keys(MINECRAFT_26_3_SNAPSHOT_9_SOUNDS_JSON).length,
    )
    expect(new Set(groupEventIds).size).toBe(groupEventIds.length)
    expect([...MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_IDS].sort()).toEqual([...groupEventIds].sort())
  })

  it('parses the snapshot sound definitions for every catalog event', () => {
    const registry = createMinecraft26_3Snapshot9SoundRegistry()
    const definitionIds = Object.keys(MINECRAFT_26_3_SNAPSHOT_9_SOUNDS_JSON)
      .map((eventId) => `minecraft:${eventId}`)
      .sort()
    const poplarAmbient = registry.events['minecraft:block.poplar_leaves.ambient']
    const cushionSit = registry.events['minecraft:entity.cushion.sit']
    const sulfurCubeHit = registry.events['minecraft:entity.sulfur_cube.slow_sliding.hit']

    if (!poplarAmbient || !cushionSit || !sulfurCubeHit) {
      throw new Error('Expected official Minecraft 26.3 Snapshot 9 sound definitions')
    }

    expect(definitionIds).toEqual([...MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_IDS].sort())
    expect(missingMinecraft26_3Snapshot9SoundEvents(registry)).toEqual([])
    expect(poplarAmbient.sounds).toHaveLength(27)
    expect(poplarAmbient).toMatchObject({
      subtitle: 'subtitles.block.poplar_leaves.ambient',
    })
    expect(cushionSit.sounds[0]).toMatchObject({
      name: 'minecraft:entity/cushion/sit1',
    })
    expect(sulfurCubeHit).toMatchObject({
      subtitle: 'subtitles.entity.sulfur_cube.hit',
    })
  })

  it('accepts a resource-pack registry containing every catalog event', () => {
    const registry = parseMinecraftSoundsJson(completeSoundsJson(), {
      namespace: 'minecraft',
    })

    expect(missingMinecraft26_3Snapshot9SoundEvents(registry)).toEqual([])
  })

  it('reports an event that the supplied resource pack does not contain', () => {
    const soundsJson = completeSoundsJson()
    delete soundsJson['minecraft:block.shelf_mushroom.break']
    const registry = parseMinecraftSoundsJson(soundsJson, {
      namespace: 'minecraft',
    })

    expect(missingMinecraft26_3Snapshot9SoundEvents(registry)).toEqual([
      'minecraft:block.shelf_mushroom.break',
    ])
  })
})

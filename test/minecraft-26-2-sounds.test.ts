import { describe, expect, it } from 'vitest'

import {
  MINECRAFT_26_2_SOUND_EVENT_GROUPS,
  MINECRAFT_26_2_SOUND_EVENT_IDS,
  MINECRAFT_26_2_SOUNDS_JSON,
  createMinecraft26_2SoundRegistry,
  missingMinecraft26_2SoundEvents,
} from '../src/domain/minecraft-26-2-sounds.js'
import { parseMinecraftSoundsJson } from '../src/domain/minecraft-sounds-parser.js'

const completeSoundsJson = (): Record<string, { sounds: string[] }> =>
  Object.fromEntries(
    MINECRAFT_26_2_SOUND_EVENT_IDS.map((eventId) => [eventId, { sounds: [eventId] }]),
  )

describe('Minecraft 26.2 sound event catalog', () => {
  it('contains the complete official event catalog', () => {
    const groupEventIds = Object.values(MINECRAFT_26_2_SOUND_EVENT_GROUPS).flat()

    expect(Object.keys(MINECRAFT_26_2_SOUNDS_JSON)).toHaveLength(1968)
    expect(MINECRAFT_26_2_SOUND_EVENT_IDS).toHaveLength(Object.keys(MINECRAFT_26_2_SOUNDS_JSON).length)
    expect(new Set(groupEventIds).size).toBe(groupEventIds.length)
    expect([...MINECRAFT_26_2_SOUND_EVENT_IDS].sort()).toEqual([...groupEventIds].sort())
  })

  it('parses the official sound definitions for every catalog event', () => {
    const registry = createMinecraft26_2SoundRegistry()
    const definitionIds = Object.keys(MINECRAFT_26_2_SOUNDS_JSON)
      .map((eventId) => `minecraft:${eventId}`)
      .sort()
    const cinnabarBreak = registry.events['minecraft:block.cinnabar.break']
    const potentSulfurActive =
      registry.events['minecraft:block.potent_sulfur.geyser_eruption_active']
    const emptyOfficialEvent = registry.events['minecraft:music.nether.warped_forest']

    if (!cinnabarBreak || !potentSulfurActive || !emptyOfficialEvent) {
      throw new Error('Expected official Minecraft 26.2 sound definitions')
    }

    expect(definitionIds).toEqual([...MINECRAFT_26_2_SOUND_EVENT_IDS].sort())
    expect(missingMinecraft26_2SoundEvents(registry)).toEqual([])
    expect(cinnabarBreak).toMatchObject({
      subtitle: 'subtitles.block.generic.break',
    })
    expect(cinnabarBreak.sounds[0]).toMatchObject({
      name: 'minecraft:block/cinnabar/break1',
    })
    expect(potentSulfurActive.sounds[0]).toMatchObject({
      name: 'minecraft:block/potent_sulfur/sulfur_spring/eruption_active1',
      volume: 2,
    })
    expect(emptyOfficialEvent.sounds).toStrictEqual([])
  })

  it('accepts a resource-pack registry containing every catalog event', () => {
    const registry = parseMinecraftSoundsJson(completeSoundsJson(), {
      namespace: 'minecraft',
    })

    expect(missingMinecraft26_2SoundEvents(registry)).toEqual([])
  })

  it('reports an event that the supplied resource pack does not contain', () => {
    const soundsJson = completeSoundsJson()
    delete soundsJson['minecraft:block.cinnabar.break']
    const registry = parseMinecraftSoundsJson(soundsJson, {
      namespace: 'minecraft',
    })

    expect(missingMinecraft26_2SoundEvents(registry)).toEqual([
      'minecraft:block.cinnabar.break',
    ])
  })
})


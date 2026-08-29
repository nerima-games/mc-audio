/* oxlint-disable max-statements, no-magic-numbers */
import { describe, expect, it } from '@effect/vitest'
import {
  initialMinecraftAmbientSoundsState,
  type MinecraftAmbientMoodResolver,
} from '../src/domain/minecraft-ambient-sounds.js'
import { LISTENER, MOOD_POSITION, plan, state } from './minecraft-ambient-sounds-support.js'

describe('Minecraft ambient sound planning', () => {
  it('starts, retains, switches, and stops the configured loop', () => {
    expect(initialMinecraftAmbientSoundsState()).toStrictEqual({ loopSound: null, nextMoodTick: 0 })

    const started = plan({ definition: { loop: 'minecraft:ambient.loop' } })
    expect(started).toStrictEqual({
      commands: [{ kind: 'start-loop', sound: 'minecraft:ambient.loop' }],
      state: state({ loopSound: 'minecraft:ambient.loop' }),
    })
    expect(
      plan({
        definition: { loop: 'minecraft:ambient.loop' },
        state: started.state,
        tick: 1,
      }),
    ).toStrictEqual({ commands: [], state: started.state })
    expect(
      plan({
        definition: { loop: 'minecraft:ambient.loop.other' },
        state: started.state,
      }),
    ).toStrictEqual({
      commands: [
        { kind: 'stop-loop' },
        { kind: 'start-loop', sound: 'minecraft:ambient.loop.other' },
      ],
      state: state({ loopSound: 'minecraft:ambient.loop.other' }),
    })
    expect(plan({ state: started.state })).toStrictEqual({
      commands: [{ kind: 'stop-loop' }],
      state: initialMinecraftAmbientSoundsState(),
    })
  })

  it('schedules mood sounds only when due and when the caller resolves the mood', () => {
    const definition = {
      mood: {
        block_search_extent: 8,
        offset: 1,
        sound: 'minecraft:ambient.mood',
        tick_delay: 4,
      },
    }
    let resolverInput: Parameters<MinecraftAmbientMoodResolver>[0] | null = null
    const moodResolver: MinecraftAmbientMoodResolver = (input) => {
      resolverInput = input
      return { delayTicks: input.mood.tick_delay, position: MOOD_POSITION }
    }
    expect(plan({ definition, moodResolver })).toStrictEqual({
      commands: [
        {
          category: 'mood',
          kind: 'play',
          offset: 1,
          position: MOOD_POSITION,
          sound: 'minecraft:ambient.mood',
        },
      ],
      state: state({ nextMoodTick: 4 }),
    })
    expect(resolverInput).toMatchObject({ cameraPosition: LISTENER, tick: 0, mood: definition.mood })
    expect(plan({ definition })).toStrictEqual({
      commands: [],
      state: state({ nextMoodTick: 4 }),
    })
    expect(
      plan({ definition, moodResolver, state: state({ nextMoodTick: 4 }), tick: 3 }),
    ).toStrictEqual({
      commands: [],
      state: state({ nextMoodTick: 4 }),
    })
    expect(
      plan({ definition: {}, state: state({ nextMoodTick: 4 }), tick: 3 }),
    ).toStrictEqual({ commands: [], state: initialMinecraftAmbientSoundsState() })
  })

  it('lets the mood resolver suppress a sound and schedule a darkness-dependent delay', () => {
    const moodResolver: MinecraftAmbientMoodResolver = ({ mood }) => ({
      delayTicks: mood.tick_delay + 5,
      position: null,
    })

    expect(
      plan({
        definition: {
          mood: {
            block_search_extent: 8,
            offset: 0,
            sound: 'minecraft:ambient.mood',
            tick_delay: 4,
          },
        },
        moodResolver,
      }),
    ).toStrictEqual({ commands: [], state: state({ nextMoodTick: 9 }) })
  })

  it('rejects invalid delays returned by the mood resolver', () => {
    const definition = {
      mood: {
        block_search_extent: 8,
        offset: 0,
        sound: 'minecraft:ambient.mood',
        tick_delay: 4,
      },
    }
    expect(() =>
      plan({
        definition,
        moodResolver: () => ({ delayTicks: 0, position: null }),
      }),
    ).toThrow()
    expect(() =>
      plan({
        definition,
        moodResolver: () => ({ delayTicks: Number.NaN, position: null }),
      }),
    ).toThrow()
  })

  it('applies addition chances through the injected random source', () => {
    let randomCalls = 0
    const result = plan({
      definition: {
        additions: [
          { sound: 'minecraft:ambient.zero', tick_chance: 0 },
          { sound: 'minecraft:ambient.one', tick_chance: 1 },
          { sound: 'minecraft:ambient.half', tick_chance: 0.5 },
        ],
      },
      randomSource: () => {
        randomCalls += 1
        return 0.4
      },
    })
    expect(result.commands).toStrictEqual([
      { category: 'addition', kind: 'play', sound: 'minecraft:ambient.one' },
      { category: 'addition', kind: 'play', sound: 'minecraft:ambient.half' },
    ])
    expect(randomCalls).toBe(1)
    expect(
      plan({
        definition: { additions: [{ sound: 'minecraft:ambient.half', tick_chance: 0.5 }] },
        randomSource: () => 0.5,
      }).commands,
    ).toStrictEqual([])
    expect(
      plan({
        definition: { additions: [{ sound: 'minecraft:ambient.half', tick_chance: 0.5 }] },
        randomSource: () => -1,
      }).commands,
    ).toHaveLength(1)
    expect(
      plan({
        definition: { additions: [{ sound: 'minecraft:ambient.half', tick_chance: 0.5 }] },
        randomSource: () => 2,
      }).commands,
    ).toStrictEqual([])
    expect(
      plan({
        definition: { additions: [{ sound: 'minecraft:ambient.half', tick_chance: 0.5 }] },
        randomSource: () => Number.NaN,
      }).commands,
    ).toHaveLength(1)
  })

  it('rejects invalid game ticks', () => {
    expect(() => plan({ tick: -1 })).toThrow()
    expect(() => plan({ tick: 0.5 })).toThrow()
    expect(() => plan({ tick: Number.NaN })).toThrow()
  })
})

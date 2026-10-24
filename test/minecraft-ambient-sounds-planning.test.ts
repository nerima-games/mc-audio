/* oxlint-disable max-statements, no-magic-numbers */
import { describe, expect, it } from '@effect/vitest'
import { Option, Result } from 'effect'
import { AudioDelayTicks, AudioTick } from '../src/domain/audio-brands.js'
import {
  initialMinecraftAmbientSoundsState,
  planMinecraftAmbientSounds,
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
        tick: AudioTick(1),
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
      state: state({ nextMoodTick: AudioTick(4) }),
    })
    expect(resolverInput).toMatchObject({ cameraPosition: LISTENER, tick: 0, mood: definition.mood })
    expect(plan({ definition })).toStrictEqual({
      commands: [],
      state: state({ nextMoodTick: AudioTick(4) }),
    })
    expect(
      plan({ definition, moodResolver, state: state({ nextMoodTick: AudioTick(4) }), tick: AudioTick(3) }),
    ).toStrictEqual({
      commands: [],
      state: state({ nextMoodTick: AudioTick(4) }),
    })
    expect(
      plan({ definition: {}, state: state({ nextMoodTick: AudioTick(4) }), tick: AudioTick(3) }),
    ).toStrictEqual({ commands: [], state: initialMinecraftAmbientSoundsState() })
  })

  it('lets the mood resolver suppress a sound and schedule a darkness-dependent delay', () => {
    const moodResolver: MinecraftAmbientMoodResolver = ({ mood }) => ({
      delayTicks: AudioDelayTicks(mood.tick_delay + 5),
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

  it('rejects a zero delay returned by the injected mood resolver', () => {
    const result = planMinecraftAmbientSounds({
      cameraPosition: LISTENER,
      definition: {
        mood: {
          block_search_extent: 8,
          offset: 0,
          sound: 'minecraft:ambient.mood',
          tick_delay: 1,
        },
      },
      moodPosition: MOOD_POSITION,
      moodResolver: () => ({ delayTicks: AudioDelayTicks(0), position: MOOD_POSITION }),
      randomSource: () => 0,
      state: initialMinecraftAmbientSoundsState(),
      tick: AudioTick(0),
    })

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: 'MinecraftAmbientSoundsPlannerFailure',
        message: 'Minecraft ambient mood delayTicks must be a positive integer',
      })
    }
  })

  it('rejects invalid delay and tick values when constructing their brands', () => {
    expect(Option.isSome(AudioDelayTicks.option(0))).toBe(true)
    expect(Option.isNone(AudioDelayTicks.option(Number.NaN))).toBe(true)
    expect(Option.isNone(AudioTick.option(-1))).toBe(true)
    expect(Option.isNone(AudioTick.option(0.5))).toBe(true)
    expect(Option.isNone(AudioTick.option(Number.NaN))).toBe(true)
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
    expect(Option.isNone(AudioTick.option(-1))).toBe(true)
    expect(Option.isNone(AudioTick.option(0.5))).toBe(true)
    expect(Option.isNone(AudioTick.option(Number.NaN))).toBe(true)
  })

  it('returns a planner failure for an invalid branded tick supplied at runtime', () => {
    const result = planMinecraftAmbientSounds({
      cameraPosition: LISTENER,
      moodPosition: null,
      randomSource: () => 0,
      state: initialMinecraftAmbientSoundsState(),
      // @ts-expect-error Simulate an invalid tick from an untyped JavaScript caller.
      tick: -1,
    })

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: 'MinecraftAmbientSoundsPlannerFailure',
        message: 'Audio tick must be a non-negative integer',
      })
    }
  })

  it('returns a planner failure when a mood delay overflows the next tick', () => {
    const maximumTick = AudioTick(Number.MAX_VALUE)
    let resolverCalls = 0
    const result = planMinecraftAmbientSounds({
      cameraPosition: LISTENER,
      definition: {
        mood: {
          block_search_extent: 0,
          offset: 0,
          sound: 'minecraft:ambient.mood',
          tick_delay: 1,
        },
      },
      moodPosition: MOOD_POSITION,
      moodResolver: () => {
        resolverCalls += 1
        return { delayTicks: AudioDelayTicks(Number.MAX_VALUE), position: MOOD_POSITION }
      },
      randomSource: () => 0,
      state: initialMinecraftAmbientSoundsState(),
      tick: maximumTick,
    })

    expect(resolverCalls).toBe(1)
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: 'MinecraftAmbientSoundsPlannerFailure',
        message: 'Audio tick must be a non-negative integer',
      })
    }
  })
})

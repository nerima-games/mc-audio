/* oxlint-disable max-statements, no-magic-numbers */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import {
  type AudioAvailability,
  AudioBackendPort,
  makeRecordingBackend,
} from '../src/domain/backend-port.js'
import {
  initialMinecraftAmbientSoundsState,
  normalizeMinecraftAmbientSoundsDefinition,
  planMinecraftAmbientSounds,
  type MinecraftAmbientSoundsDefinition,
  type MinecraftAmbientSoundsPlannerInput,
  type MinecraftAmbientSoundsState,
} from '../src/domain/minecraft-ambient-sounds.js'
import { makeMinecraftAmbientSoundsPlayer } from '../src/domain/minecraft-ambient-sounds-player.js'
import { parseMinecraftSoundsJson } from '../src/domain/minecraft-sounds.js'

const REGISTRY = parseMinecraftSoundsJson(
  {
    'ambient.addition': { sounds: ['ambient/addition'] },
    'ambient.loop': {
      sounds: [
        {
          attenuation_distance: 24,
          name: 'ambient/loop',
          pitch: 1.25,
          stream: true,
          volume: 0.5,
        },
      ],
    },
    'ambient.loop.other': { sounds: ['ambient/loop_other'] },
    'ambient.mood': {
      sounds: [{ attenuation_distance: 24, name: 'ambient/mood', volume: 0.75 }],
    },
    'ambient.loud': { sounds: [{ name: 'ambient/loud', volume: 4 }] },
  },
  { namespace: 'minecraft' },
)

const LISTENER = { x: 0, y: 64, z: 0 }
const CAMERA = {
  capturedAtSecs: MonotonicTimeSecs(5),
  pitchRadians: 0,
  position: LISTENER,
  yawRadians: 0,
}
const MOOD_POSITION = { x: 6, y: 64, z: 0 }
const LISTENER_FORWARD = { x: 0, y: 0, z: -1 }

const asDefinition = (value: unknown): MinecraftAmbientSoundsDefinition =>
  value as MinecraftAmbientSoundsDefinition

const state = (overrides: Partial<MinecraftAmbientSoundsState> = {}): MinecraftAmbientSoundsState => ({
  ...initialMinecraftAmbientSoundsState(),
  ...overrides,
})

const plan = (overrides: Partial<MinecraftAmbientSoundsPlannerInput> = {}) =>
  planMinecraftAmbientSounds({
    definition: null,
    moodPosition: null,
    randomSource: () => 0,
    state: state(),
    tick: 0,
    ...overrides,
  } as MinecraftAmbientSoundsPlannerInput)

const makeHarness = (
  availability: AudioAvailability = 'ready',
  randomSource: () => number = () => 0,
) =>
  Effect.gen(function* makeHarnessEffect() {
    const recorded = yield* makeRecordingBackend(availability)
    const player = yield* makeMinecraftAmbientSoundsPlayer(REGISTRY, randomSource).pipe(
      Effect.provide(Layer.succeed(AudioBackendPort, recorded.backend)),
    )
    return { player, recorded }
  })

describe('Minecraft ambient sound definitions', () => {
  it('normalizes the official defaults and fields', () => {
    expect(normalizeMinecraftAmbientSoundsDefinition()).toStrictEqual({
      additions: [],
      loop: null,
      mood: null,
    })
    expect(normalizeMinecraftAmbientSoundsDefinition(null)).toStrictEqual({
      additions: [],
      loop: null,
      mood: null,
    })
    expect(
      normalizeMinecraftAmbientSoundsDefinition(
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
      ),
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
      normalizeMinecraftAmbientSoundsDefinition(
        asDefinition({ additions: null, loop: null, mood: null }),
      ),
    ).toStrictEqual({ additions: [], loop: null, mood: null })
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
      expect(() => normalizeMinecraftAmbientSoundsDefinition(invalid)).toThrow()
    }
  })
})

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

  it('schedules mood sounds only when due and when the caller supplies a position', () => {
    const definition = {
      mood: {
        block_search_extent: 8,
        offset: 1,
        sound: 'minecraft:ambient.mood',
        tick_delay: 4,
      },
    }
    expect(plan({ definition, moodPosition: MOOD_POSITION })).toStrictEqual({
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
    expect(plan({ definition, moodPosition: null })).toStrictEqual({
      commands: [],
      state: state({ nextMoodTick: 4 }),
    })
    expect(
      plan({ definition, moodPosition: MOOD_POSITION, state: state({ nextMoodTick: 4 }), tick: 3 }),
    ).toStrictEqual({
      commands: [],
      state: state({ nextMoodTick: 4 }),
    })
    expect(
      plan({ definition: {}, state: state({ nextMoodTick: 4 }), tick: 3 }),
    ).toStrictEqual({ commands: [], state: initialMinecraftAmbientSoundsState() })
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

describe('Minecraft ambient sound player', () => {
  it.effect('plays loop, mood, and addition events through the sound registry', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      const definition = {
        additions: [{ sound: 'minecraft:ambient.addition', tick_chance: 1 }],
        loop: 'minecraft:ambient.loop',
        mood: {
          block_search_extent: 8,
          offset: 1,
          sound: 'minecraft:ambient.mood',
          tick_delay: 4,
        },
      }

      const first = yield* player.tick({
        ambientVolume: 0.5,
        camera: CAMERA,
        definition,
        listener: { x: 100, y: 64, z: 0 },
        listenerForward: LISTENER_FORWARD,
        moodPosition: MOOD_POSITION,
        tick: 0,
      })
      expect(first.playedSoundIds).toStrictEqual([
        'minecraft:ambient/loop',
        'minecraft:ambient/mood',
        'minecraft:ambient/addition',
      ])
      const played = yield* recorded.played
      expect(played).toStrictEqual([
        expect.objectContaining({
          gain: 0.25,
          loop: true,
          naturalDuration: true,
          playbackRate: 1.25,
          sampleOnly: true,
          soundId: 'minecraft:ambient/loop',
          stream: true,
        }),
        expect.objectContaining({
          loop: false,
          pan: 0.25,
          sampleOnly: true,
          soundId: 'minecraft:ambient/mood',
        }),
        expect.objectContaining({
          gain: 0.5,
          loop: false,
          pan: 0,
          sampleOnly: true,
          soundId: 'minecraft:ambient/addition',
        }),
      ])
      expect(played[1]?.gain).toBeCloseTo(0.2903225806, 10)

      const second = yield* player.tick({ definition, listener: LISTENER, tick: 1 })
      expect(second.plan.commands).toStrictEqual([
        { category: 'addition', kind: 'play', sound: 'minecraft:ambient.addition' },
      ])
      expect(yield* recorded.played).toHaveLength(4)
    }),
  )

  it.effect('preserves official ambient variant volumes above unity', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      const result = yield* player.tick({
        definition: { additions: [{ sound: 'minecraft:ambient.loud', tick_chance: 1 }] },
        listener: LISTENER,
        tick: 0,
      })

      expect(result.playedSoundIds).toStrictEqual(['minecraft:ambient/loud'])
      expect(yield* recorded.played).toMatchObject([{ gain: 4, soundId: 'minecraft:ambient/loud' }])
    }),
  )

  it.effect('stops loop handles when the definition changes, disables, or stops', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      yield* player.stop
      yield* player.tick({ definition: { loop: 'minecraft:ambient.loop' }, listener: LISTENER, tick: 0 })
      expect(yield* recorded.backend.isToneActive({ id: 1 })).toBe(true)

      const changed = yield* player.tick({
        definition: { loop: 'minecraft:ambient.loop.other' },
        listener: LISTENER,
        tick: 1,
      })
      expect(changed.plan.commands).toStrictEqual([
        { kind: 'stop-loop' },
        { kind: 'start-loop', sound: 'minecraft:ambient.loop.other' },
      ])
      expect(yield* recorded.backend.isToneActive({ id: 1 })).toBe(false)
      expect(yield* recorded.backend.isToneActive({ id: 2 })).toBe(true)

      const disabled = yield* player.tick({
        definition: { loop: 'minecraft:ambient.loop.other' },
        enabled: false,
        listener: LISTENER,
        tick: 2,
      })
      expect(disabled.plan.commands).toStrictEqual([{ kind: 'stop-loop' }])
      expect(yield* recorded.backend.isToneActive({ id: 2 })).toBe(false)
      yield* player.stop
    }),
  )

  it.effect('does not ask locked or unavailable backends to play', () =>
    Effect.gen(function* () {
      for (const availability of ['locked', 'unavailable'] as const) {
        const { player, recorded } = yield* makeHarness(availability)
        const result = yield* player.tick({
          definition: { loop: 'minecraft:ambient.loop' },
          listener: LISTENER,
          tick: 0,
        })
        expect(result).toStrictEqual({
          plan: { commands: [], state: initialMinecraftAmbientSoundsState() },
          playedSoundIds: [],
        })
        expect(yield* recorded.played).toHaveLength(0)
        yield* player.stop
      }
    }),
  )

  it.effect('returns a typed error for an unknown sound event', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      const result = yield* Effect.either(
        player.tick({ definition: { loop: 'minecraft:ambient.missing' }, listener: LISTENER, tick: 0 }),
      )

      expect(result).toMatchObject({
        _tag: 'Left',
        left: {
          _tag: 'MinecraftAmbientSoundsPlaybackError',
          soundId: 'minecraft:ambient.missing',
        },
      })
      expect(yield* recorded.played).toHaveLength(0)
    }),
  )

  it.effect('spatialises mood sounds without an explicit listener forward vector', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      yield* player.tick({
        definition: {
          mood: {
            block_search_extent: 8,
            offset: 0,
            sound: 'minecraft:ambient.mood',
            tick_delay: 1,
          },
        },
        listener: LISTENER,
        moodPosition: MOOD_POSITION,
        tick: 0,
      })

      expect(yield* recorded.played).toMatchObject([{ soundId: 'minecraft:ambient/mood' }])
    }),
  )

  it.effect('accepts an omitted definition and uses the default ambient volume', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      const result = yield* player.tick({
        definition: { additions: [{ sound: 'minecraft:ambient.addition', tick_chance: 1 }] },
        listener: LISTENER,
        tick: 0,
      })

      expect(result.playedSoundIds).toStrictEqual(['minecraft:ambient/addition'])
      expect(yield* recorded.played).toMatchObject([{ gain: 1, soundId: 'minecraft:ambient/addition' }])

      const empty = yield* player.tick({ listener: LISTENER, tick: 1 })
      expect(empty.plan.commands).toStrictEqual([])
    }),
  )

  it.effect('rolls back started loops when a later ambient command fails', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      const result = yield* Effect.either(
        player.tick({
          definition: {
            loop: 'minecraft:ambient.loop',
            mood: {
              block_search_extent: 8,
              offset: 0,
              sound: 'minecraft:ambient.missing',
              tick_delay: 1,
            },
          },
          listener: LISTENER,
          moodPosition: MOOD_POSITION,
          tick: 0,
        }),
      )

      expect(result).toMatchObject({
        _tag: 'Left',
        left: {
          _tag: 'MinecraftAmbientSoundsPlaybackError',
          soundId: 'minecraft:ambient.missing',
        },
      })
      expect(yield* recorded.backend.isToneActive({ id: 1 })).toBe(false)

      yield* player.tick({
        definition: { loop: 'minecraft:ambient.loop' },
        listener: LISTENER,
        tick: 0,
      })
      expect(yield* recorded.backend.isToneActive({ id: 2 })).toBe(true)
      yield* player.stop
      expect(yield* recorded.backend.isToneActive({ id: 2 })).toBe(false)
    }),
  )

  it.effect('clears the loop reference when replacement fails after stopping the old loop', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      yield* player.tick({
        definition: { loop: 'minecraft:ambient.loop' },
        listener: LISTENER,
        tick: 0,
      })

      const result = yield* Effect.either(
        player.tick({
          definition: {
            loop: 'minecraft:ambient.loop.other',
            mood: {
              block_search_extent: 8,
              offset: 0,
              sound: 'minecraft:ambient.missing',
              tick_delay: 1,
            },
          },
          listener: LISTENER,
          moodPosition: MOOD_POSITION,
          tick: 1,
        }),
      )

      expect(result).toMatchObject({
        _tag: 'Left',
        left: {
          _tag: 'MinecraftAmbientSoundsPlaybackError',
          soundId: 'minecraft:ambient.missing',
        },
      })
      expect(yield* recorded.backend.isToneActive({ id: 1 })).toBe(false)
      expect(yield* recorded.backend.isToneActive({ id: 2 })).toBe(false)
      yield* player.stop
    }),
  )
})

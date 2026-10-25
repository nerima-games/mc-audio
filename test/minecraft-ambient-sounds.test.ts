/* oxlint-disable max-statements, no-magic-numbers */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Result } from 'effect'
import { AngleRadians } from '@nerima-games/mc-kernel/domain/shared-vocabulary'
import { PositionAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import { MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'
import { AudioHandleId, AudioTick, AudioVolume, MinecraftSoundEventId, MinecraftSoundNamespace } from '../src/domain/audio-brands.js'
import {
  type AudioAvailability,
  AudioBackendPort,
  makeRecordingBackend,
} from '../src/domain/backend-port.js'
import {
  initialMinecraftAmbientSoundsState,
  normalizeMinecraftAmbientSoundsDefinition,
  planMinecraftAmbientSounds,
  type MinecraftAmbientSoundsPlannerInput,
  type MinecraftAmbientSoundsState,
} from '../src/domain/minecraft-ambient-sounds.js'
import { makeMinecraftAmbientSoundsPlayer } from '../src/domain/minecraft-ambient-sounds-player.js'
import { parseMinecraftSoundsJson } from '../src/domain/minecraft-sounds.js'

const registryResult = parseMinecraftSoundsJson(
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
  { namespace: MinecraftSoundNamespace('minecraft') },
)
if (Result.isFailure(registryResult)) {
  throw new Error('Expected the ambient sound fixture to parse')
}
const REGISTRY = registryResult.success

const LISTENER = { x: PositionAxis(0), y: PositionAxis(64), z: PositionAxis(0) }
const CAMERA = {
  capturedAtSecs: MonotonicTimeSecs(5),
  pitchRadians: AngleRadians(0),
  position: LISTENER,
  yawRadians: AngleRadians(0),
}
const MOOD_POSITION = { x: PositionAxis(6), y: PositionAxis(64), z: PositionAxis(0) }
const LISTENER_FORWARD = { x: PositionAxis(0), y: PositionAxis(0), z: PositionAxis(-1) }

const normalizeUnknown = (value?: unknown): unknown => {
  const result = normalizeMinecraftAmbientSoundsDefinition(value)
  if (Result.isFailure(result)) {
    throw result.failure
  }
  return result.success
}
type StateOverrides = Omit<Partial<MinecraftAmbientSoundsState>, 'loopSound' | 'nextMoodTick'> & {
  readonly loopSound?: string | null
  readonly nextMoodTick?: number
}

const requiredTick = (value: number): AudioTick => {
  const tick = AudioTick.option(value)
  if (Option.isNone(tick)) {
    throw new Error(`Test fixture tick is invalid: ${value}`)
  }
  return tick.value
}
const tick = requiredTick
const toneHandle = (id: number) => ({ id: AudioHandleId(id) })
const requiredSound = (value: string): MinecraftSoundEventId => {
  const sound = MinecraftSoundEventId.option(value)
  if (Option.isNone(sound)) {
    throw new Error(`Test fixture sound id is invalid: ${value}`)
  }
  return sound.value
}

const state = (overrides: StateOverrides = {}): MinecraftAmbientSoundsState => {
  const initial = initialMinecraftAmbientSoundsState()
  const loopSound = overrides.loopSound ?? initial.loopSound
  return {
    ...initial,
    ...overrides,
    loopSound: loopSound === null ? null : requiredSound(loopSound),
    nextMoodTick: requiredTick(overrides.nextMoodTick ?? initial.nextMoodTick),
  }
}

type PlannerOverrides = Omit<Partial<MinecraftAmbientSoundsPlannerInput>, 'tick'> & { readonly tick?: number }

const plan = (overrides: PlannerOverrides = {}) => {
  const result = planMinecraftAmbientSounds({
    cameraPosition: LISTENER,
    definition: null,
    moodPosition: null,
    randomSource: () => 0,
    ...overrides,
    state: overrides.state ?? state(),
    tick: requiredTick(overrides.tick ?? 0),
  })
  if (Result.isFailure(result)) {
    throw result.failure
  }
  return result.success
}

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
    expect(normalizeUnknown()).toStrictEqual({
      additions: [],
      loop: null,
      mood: null,
    })
    expect(normalizeUnknown(null)).toStrictEqual({
      additions: [],
      loop: null,
      mood: null,
    })
    expect(
      normalizeUnknown({
          additions: [],
          loop: 'minecraft:ambient.loop',
          mood: {
            block_search_extent: 8,
            offset: 0.5,
            sound: 'minecraft:ambient.mood',
            tick_delay: 80,
          },
      }),
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
      normalizeUnknown({ additions: null, loop: null, mood: null }),
    ).toStrictEqual({ additions: [], loop: null, mood: null })
  })

  it('rejects malformed loop, mood, addition, and probability fields', () => {
    const invalidDefinitions: readonly unknown[] = [
      [],
      { unknown: true },
      { loop: 1 },
      { loop: '' },
      { mood: [] },
      { mood: 1 },
      { mood: {} },
      {
        mood: {
          block_search_extent: 0,
          offset: 0,
          sound: 'mood',
          tick_delay: 1,
          unknown: true,
        },
      },
      { mood: { block_search_extent: 0, offset: 0, sound: '', tick_delay: 1 } },
      { mood: { block_search_extent: 0, offset: 0, sound: 'mood', tick_delay: '1' } },
      { mood: { block_search_extent: 0, offset: 0, sound: 'mood', tick_delay: 0 } },
      { mood: { block_search_extent: 0, offset: 0, sound: 'mood', tick_delay: 0.5 } },
      { mood: { block_search_extent: -1, offset: 0, sound: 'mood', tick_delay: 1 } },
      { mood: { block_search_extent: 0.5, offset: 0, sound: 'mood', tick_delay: 1 } },
      { mood: { block_search_extent: 0, offset: '0', sound: 'mood', tick_delay: 1 } },
      { mood: { block_search_extent: 0, offset: Number.NaN, sound: 'mood', tick_delay: 1 } },
      { additions: 1 },
      { additions: [1] },
      { additions: [{}] },
      { additions: [[]] },
      { additions: [{ sound: 'addition', tick_chance: 1, unknown: true }] },
      { additions: [{ sound: 'addition', tick_chance: '0' }] },
      { additions: [{ sound: 'addition', tick_chance: Number.NaN }] },
      { additions: [{ sound: 'addition', tick_chance: -0.1 }] },
      { additions: [{ sound: 'addition', tick_chance: 1.1 }] },
    ]
    for (const definition of invalidDefinitions) {
      const result = normalizeMinecraftAmbientSoundsDefinition(definition)
      expect(Result.isFailure(result)).toBe(true)
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
    const invalidRandom = planMinecraftAmbientSounds({
      cameraPosition: LISTENER,
      definition: { additions: [{ sound: 'minecraft:ambient.half', tick_chance: 0.5 }] },
      moodPosition: null,
      randomSource: () => Number.NaN,
      state: state(),
      tick: AudioTick(0),
    })
    expect(Result.isFailure(invalidRandom)).toBe(true)
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
        ambientVolume: AudioVolume(0.5),
        camera: CAMERA,
        definition,
        listener: { x: PositionAxis(100), y: PositionAxis(64), z: PositionAxis(0) },
        listenerForward: LISTENER_FORWARD,
        moodPosition: MOOD_POSITION,
        tick: tick(0),
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

      const second = yield* player.tick({ definition, listener: LISTENER, tick: tick(1) })
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
        tick: tick(0),
      })

      expect(result.playedSoundIds).toStrictEqual(['minecraft:ambient/loud'])
      expect(yield* recorded.played).toMatchObject([{ gain: 4, soundId: 'minecraft:ambient/loud' }])
    }),
  )

  it.effect('stops loop handles when the definition changes, disables, or stops', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      yield* player.stop
      yield* player.tick({ definition: { loop: 'minecraft:ambient.loop' }, listener: LISTENER, tick: tick(0) })
      expect(yield* recorded.backend.isToneActive(toneHandle(1))).toBe(true)

      const changed = yield* player.tick({
        definition: { loop: 'minecraft:ambient.loop.other' },
        listener: LISTENER,
        tick: tick(1),
      })
      expect(changed.plan.commands).toStrictEqual([
        { kind: 'stop-loop' },
        { kind: 'start-loop', sound: 'minecraft:ambient.loop.other' },
      ])
      expect(yield* recorded.backend.isToneActive(toneHandle(1))).toBe(false)
      expect(yield* recorded.backend.isToneActive(toneHandle(2))).toBe(true)

      const disabled = yield* player.tick({
        definition: { loop: 'minecraft:ambient.loop.other' },
        enabled: false,
        listener: LISTENER,
        tick: tick(2),
      })
      expect(disabled.plan.commands).toStrictEqual([{ kind: 'stop-loop' }])
      expect(yield* recorded.backend.isToneActive(toneHandle(2))).toBe(false)
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
          tick: tick(0),
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
      const result = yield* player.tick({ definition: { loop: 'minecraft:ambient.missing' }, listener: LISTENER, tick: tick(0) })
        .pipe(Effect.catch((error) => Effect.succeed(error)))

      expect(result).toMatchObject({
        _tag: 'MinecraftAmbientSoundsPlaybackError',
        soundId: 'minecraft:ambient.missing',
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
        tick: tick(0),
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
        tick: tick(0),
      })

      expect(result.playedSoundIds).toStrictEqual(['minecraft:ambient/addition'])
      expect(yield* recorded.played).toMatchObject([{ gain: 1, soundId: 'minecraft:ambient/addition' }])

      const empty = yield* player.tick({ listener: LISTENER, tick: tick(1) })
      expect(empty.plan.commands).toStrictEqual([])
    }),
  )

  it.effect('rolls back started loops when a later ambient command fails', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      const result = yield* player.tick({
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
          tick: tick(0),
        }).pipe(Effect.catch((error) => Effect.succeed(error)))

      expect(result).toMatchObject({
        _tag: 'MinecraftAmbientSoundsPlaybackError',
        soundId: 'minecraft:ambient.missing',
      })
      expect(yield* recorded.backend.isToneActive(toneHandle(1))).toBe(false)

      yield* player.tick({
        definition: { loop: 'minecraft:ambient.loop' },
        listener: LISTENER,
        tick: tick(0),
      })
      expect(yield* recorded.backend.isToneActive(toneHandle(2))).toBe(true)
      yield* player.stop
      expect(yield* recorded.backend.isToneActive(toneHandle(2))).toBe(false)
    }),
  )

  it.effect('clears the loop reference when replacement fails after stopping the old loop', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      yield* player.tick({
        definition: { loop: 'minecraft:ambient.loop' },
        listener: LISTENER,
        tick: tick(0),
      })

      const result = yield* player.tick({
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
          tick: tick(1),
        }).pipe(Effect.catch((error) => Effect.succeed(error)))

      expect(result).toMatchObject({
        _tag: 'MinecraftAmbientSoundsPlaybackError',
        soundId: 'minecraft:ambient.missing',
      })
      expect(yield* recorded.backend.isToneActive(toneHandle(1))).toBe(false)
      expect(yield* recorded.backend.isToneActive(toneHandle(2))).toBe(false)
      yield* player.stop
    }),
  )
})

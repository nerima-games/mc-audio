/* oxlint-disable max-statements, no-magic-numbers */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { AudioDelayTicks, AudioHandleId, AudioTick, AudioVolume } from '../src/domain/audio-brands.js'
import { PositionAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import {
  type AudioBackend,
  AudioBackendPort,
  makeRecordingBackend,
} from '../src/domain/backend-port.js'
import { initialMinecraftAmbientSoundsState } from '../src/domain/minecraft-ambient-sounds.js'
import { makeMinecraftAmbientSoundsPlayer } from '../src/domain/minecraft-ambient-sounds-player.js'
import {
  CAMERA,
  LISTENER,
  LISTENER_FORWARD,
  makeHarness,
  MOOD_POSITION,
  REGISTRY,
} from './minecraft-ambient-sounds-support.js'

const tick = (value: number): AudioTick => AudioTick(value)
const handle = (id: number) => ({ id: AudioHandleId(id) })

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
        moodResolver: () => ({ delayTicks: AudioDelayTicks(4), position: MOOD_POSITION }),
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
      expect(played[1]?.gain).toBeCloseTo(0.265625, 10)

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
      expect(yield* recorded.backend.isToneActive(handle(1))).toBe(true)

      const changed = yield* player.tick({
        definition: { loop: 'minecraft:ambient.loop.other' },
        listener: LISTENER,
        tick: tick(1),
      })
      expect(changed.plan.commands).toStrictEqual([
        { kind: 'stop-loop' },
        { kind: 'start-loop', sound: 'minecraft:ambient.loop.other' },
      ])
      expect(yield* recorded.backend.isToneActive(handle(1))).toBe(false)
      expect(yield* recorded.backend.isToneActive(handle(2))).toBe(true)

      const disabled = yield* player.tick({
        definition: { loop: 'minecraft:ambient.loop.other' },
        enabled: false,
        listener: LISTENER,
        tick: tick(2),
      })
      expect(disabled.plan.commands).toStrictEqual([{ kind: 'stop-loop' }])
      expect(yield* recorded.backend.isToneActive(handle(2))).toBe(false)
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

  it.effect('does not retain an ambient loop when the backend refuses it', () =>
    Effect.gen(function* () {
      const recorded = yield* makeRecordingBackend('ready')
      const refusingBackend: AudioBackend = {
        ...recorded.backend,
        playTone: () => Effect.succeed({ accepted: false, id: AudioHandleId(1) }),
      }
      const player = yield* makeMinecraftAmbientSoundsPlayer(REGISTRY, () => 0).pipe(
        Effect.provide(Layer.succeed(AudioBackendPort, refusingBackend)),
      )

      const result = yield* player.tick({
        definition: { loop: 'minecraft:ambient.loop' },
        listener: LISTENER,
        tick: tick(0),
      })

      expect(result.plan.commands).toStrictEqual([{ kind: 'start-loop', sound: 'minecraft:ambient.loop' }])
      expect(result.plan.state.loopSound).toBeNull()
      expect(result.playedSoundIds).toStrictEqual([])
      yield* player.stop
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

  it.effect('maps an invalid resolver delay to a planner playback error before playing', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      const result = yield* player.tick({
        definition: {
          mood: {
            block_search_extent: 8,
            offset: 0,
            sound: 'minecraft:ambient.mood',
            tick_delay: 1,
          },
        },
        listener: LISTENER,
        moodResolver: () => ({ delayTicks: AudioDelayTicks(0), position: MOOD_POSITION }),
        tick: tick(0),
      }).pipe(Effect.catch((error) => Effect.succeed(error)))

      expect(result).toMatchObject({
        _tag: 'MinecraftAmbientSoundsPlaybackError',
        cause: {
          _tag: 'MinecraftAmbientSoundsPlannerFailure',
          message: 'Minecraft ambient mood delayTicks must be a positive integer',
        },
        soundId: null,
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
        moodResolver: () => ({ delayTicks: AudioDelayTicks(1), position: MOOD_POSITION }),
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
          moodResolver: () => ({ delayTicks: AudioDelayTicks(1), position: MOOD_POSITION }),
          tick: tick(0),
        }).pipe(Effect.catch((error) => Effect.succeed(error)))

      expect(result).toMatchObject({
        _tag: 'MinecraftAmbientSoundsPlaybackError',
        soundId: 'minecraft:ambient.missing',
      })
      expect(yield* recorded.backend.isToneActive(handle(1))).toBe(false)

      yield* player.tick({
        definition: { loop: 'minecraft:ambient.loop' },
        listener: LISTENER,
        tick: tick(0),
      })
      expect(yield* recorded.backend.isToneActive(handle(2))).toBe(true)
      yield* player.stop
      expect(yield* recorded.backend.isToneActive(handle(2))).toBe(false)
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
          moodResolver: () => ({ delayTicks: AudioDelayTicks(1), position: MOOD_POSITION }),
          tick: tick(1),
        }).pipe(Effect.catch((error) => Effect.succeed(error)))

      expect(result).toMatchObject({
        _tag: 'MinecraftAmbientSoundsPlaybackError',
        soundId: 'minecraft:ambient.missing',
      })
      expect(yield* recorded.backend.isToneActive(handle(1))).toBe(false)
      expect(yield* recorded.backend.isToneActive(handle(2))).toBe(false)
      yield* player.stop
    }),
  )
})

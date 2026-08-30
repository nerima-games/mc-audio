/* oxlint-disable max-statements, no-magic-numbers */
import { describe, expect, it } from '@effect/vitest'
import { Either, Effect, Layer } from 'effect'
import {
  type AudioBackend,
  type AudioAvailability,
  AudioBackendPort,
  makeRecordingBackend,
} from '../src/domain/backend-port.js'
import {
  MINECRAFT_MUSIC_STARTING_DELAY_TICKS,
  type MinecraftMusicDefinition,
} from '../src/domain/minecraft-music.js'
import { normalizeMinecraftAudioComponent } from '../src/domain/minecraft-audio.js'
import type { MinecraftSoundRegistry } from '../src/domain/minecraft-sounds.js'
import {
  makeMinecraftMusicPlayer,
  type MinecraftMusicPlayer,
  type MinecraftMusicTickInput,
} from '../src/domain/minecraft-music-player.js'
import { createFreeMinecraftMusicRegistry } from '../src/domain/free-music-bank.js'

const REGISTRY = createFreeMinecraftMusicRegistry()
const METADATA_REGISTRY: MinecraftSoundRegistry = {
  events: {
    'minecraft:music.game': {
      id: 'minecraft:music.game',
      replace: false,
      sounds: [
        {
          attenuationDistance: 16,
          pitch: 1.25,
          preload: true,
          name: 'minecraft:music/free_game',
          stream: true,
          type: 'sound',
          volume: 0.5,
          weight: 1,
        },
      ],
      subtitle: null,
    },
  },
}
const LOUD_METADATA_REGISTRY: MinecraftSoundRegistry = {
  events: {
    'minecraft:music.game': {
      id: 'minecraft:music.game',
      replace: false,
      sounds: [
        {
          attenuationDistance: 16,
          pitch: 1.25,
          preload: true,
          name: 'minecraft:music/free_game',
          stream: true,
          type: 'sound',
          volume: 4,
          weight: 1,
        },
      ],
      subtitle: null,
    },
  },
}
const START_DEFINITION: MinecraftMusicDefinition = {
  max_delay: 0,
  min_delay: 0,
  sound: 'minecraft:music.game',
}
const START_INPUT: MinecraftMusicTickInput = {
  context: { creative: false, underwater: false },
  definition: START_DEFINITION,
  musicVolume: 1,
}

const makeHarness = (
  availability: AudioAvailability = 'ready',
  randomSource: () => number = () => 0,
  registry: MinecraftSoundRegistry = REGISTRY,
) =>
  Effect.gen(function* makeHarnessEffect() {
    const recorded = yield* makeRecordingBackend(availability)
    const player = yield* makeMinecraftMusicPlayer(registry, randomSource).pipe(
      Effect.provide(Layer.succeed(AudioBackendPort, recorded.backend)),
    )
    return { player, recorded }
  })

const tickToStart = (player: MinecraftMusicPlayer, input: MinecraftMusicTickInput = START_INPUT) =>
  Effect.gen(function* tickToStartEffect() {
    let result = yield* player.tick(input)
    for (let index = 0; index < MINECRAFT_MUSIC_STARTING_DELAY_TICKS; index += 1) {
      result = yield* player.tick(input)
    }
    return result
  })

describe('Minecraft music player', () => {
  it.effect('uses the context definition and waits through the startup delay', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      const result = yield* tickToStart(player)

      expect(result.played).toBe(true)
      expect(result.soundId).toBe('minecraft:music.game')
      expect(yield* recorded.musicPlayed).toStrictEqual([
        { gain: 0.4, playbackRate: 1, soundId: 'minecraft:music/free_game', stream: true },
      ])
    }),
  )

  it.effect('falls back to the context definition and forwards underwater volume when omitted', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness('ready', () => 0.99)
      const result = yield* tickToStart(player, {
        context: { creative: false, underwater: true },
      })
      expect(result.soundId).toBe('minecraft:music.under_water')
      expect(yield* recorded.musicPlayed).toStrictEqual([
        { gain: 0.4, playbackRate: 1, soundId: 'minecraft:music/free_underwater', stream: true },
      ])
    }),
  )

  it.effect('keeps an omitted official background_music component silent', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      const { backgroundMusic } = normalizeMinecraftAudioComponent()
      const result = yield* tickToStart(player, {
        backgroundMusic,
        context: { creative: false, underwater: false },
      })

      expect(result.played).toBe(false)
      expect(result.soundId).toBeNull()
      expect(yield* recorded.musicPlayed).toStrictEqual([])
    }),
  )

  it.effect('uses the data-driven background_music object and treats an empty object as silent', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness('ready', () => 0.99)
      const backgroundMusic = {
        creative: { ...START_DEFINITION, sound: 'minecraft:music.creative' },
        default: START_DEFINITION,
        underwater: { ...START_DEFINITION, sound: 'minecraft:music.under_water' },
      }

      const result = yield* tickToStart(player, {
        backgroundMusic,
        context: { creative: true, underwater: false },
      })
      expect(result.soundId).toBe('minecraft:music.creative')
      expect(yield* recorded.musicPlayed).toStrictEqual([
        { gain: 1, playbackRate: 1, soundId: 'minecraft:music/free_creative', stream: true },
      ])

      const stopped = yield* player.tick({
        backgroundMusic: {},
        context: { creative: true, underwater: false },
      })
      expect(stopped.soundId).toBeNull()
      expect(yield* recorded.backend.isToneActive({ id: 1 })).toBe(false)
    }),
  )

  it.effect('selects weighted biome music and retains it until the track ends', () =>
    Effect.gen(function* () {
      let randomValue = 0
      const { player, recorded } = yield* makeHarness('ready', () => randomValue)
      const biomeMusic = [
        { data: { ...START_DEFINITION, sound: 'minecraft:music.game' }, weight: 1 },
        { data: { ...START_DEFINITION, sound: 'minecraft:music.creative' }, weight: 1 },
      ] as const
      const input: MinecraftMusicTickInput = {
        biomeMusic,
        context: { creative: false, underwater: false },
      }

      const first = yield* tickToStart(player, input)
      expect(first.soundId).toBe('minecraft:music.game')

      randomValue = 0.99
      const retained = yield* player.tick(input)
      expect(retained.soundId).toBe('minecraft:music.game')

      yield* recorded.backend.stopTone({ id: 1 })
      const ended = yield* player.tick(input)
      expect(ended.soundId).toBeNull()
      expect(ended.plan.state.currentSound).toBeNull()

      const second = yield* tickToStart(player, input)
      expect(second.soundId).toBe('minecraft:music.creative')
      expect(yield* recorded.musicPlayed).toHaveLength(2)
    }),
  )

  it.effect('plays the Sulfur Caves free track through biome music', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      const input: MinecraftMusicTickInput = {
        biomeMusic: [
          {
            data: { ...START_DEFINITION, sound: 'minecraft:music.free_sulfur_caves' },
            weight: 1,
          },
        ],
        context: { creative: false, underwater: false },
      }

      const result = yield* tickToStart(player, input)

      expect(result.soundId).toBe('minecraft:music.free_sulfur_caves')
      expect(yield* recorded.musicPlayed).toStrictEqual([
        {
          gain: 1,
          playbackRate: 1,
          soundId: 'minecraft:music/free_sulfur_caves',
          stream: true,
        },
      ])
    }),
  )

  it.effect('stops immediately when the data-driven definition is explicitly null', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      yield* tickToStart(player)

      const result = yield* player.tick({ ...START_INPUT, definition: null })

      expect(result.played).toBe(false)
      expect(result.soundId).toBeNull()
      expect(yield* recorded.backend.isToneActive({ id: 1 })).toBe(false)
    }),
  )

  it.effect('applies Minecraft-style volume steps to the active track', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      yield* tickToStart(player)

      const result = yield* player.tick({ ...START_INPUT, musicVolume: 0 })

      expect(result.played).toBe(false)
      expect(yield* recorded.toneGains).toStrictEqual([{ gain: 0.38, handle: { id: 1 } }])
    }),
  )

  it.effect('keeps resolved variant volume during gain steps', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness('ready', () => 0, METADATA_REGISTRY)
      yield* tickToStart(player)

      yield* player.tick({ ...START_INPUT, musicVolume: 0 })

      expect(yield* recorded.toneGains).toStrictEqual([{ gain: 0.475, handle: { id: 1 } }])
    }),
  )

  it.effect('replaces a track only when replace_current_music is true', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      yield* tickToStart(player)

      const replacement: MinecraftMusicDefinition = {
        max_delay: 0,
        min_delay: 0,
        replace_current_music: true,
        sound: 'minecraft:music.creative',
      }
      const result = yield* player.tick({ ...START_INPUT, definition: replacement })

      expect(result.played).toBe(true)
      expect(result.soundId).toBe('minecraft:music.creative')
      expect(yield* recorded.musicPlayed).toStrictEqual([
        { gain: 0.4, playbackRate: 1, soundId: 'minecraft:music/free_game', stream: true },
        { gain: 0.4, playbackRate: 1, soundId: 'minecraft:music/free_game', stream: true },
      ])
      expect(yield* recorded.backend.isToneActive({ id: 1 })).toBe(false)
      expect(yield* recorded.backend.isToneActive({ id: 2 })).toBe(true)
    }),
  )

  it.effect('keeps the current track when replacement resolution fails', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      yield* tickToStart(player)

      const result = yield* Effect.either(player.tick({
        ...START_INPUT,
        definition: {
          max_delay: 0,
          min_delay: 0,
          replace_current_music: true,
          sound: 'minecraft:music.missing',
        },
      }))

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({
          _tag: 'MinecraftMusicPlaybackError',
          soundId: 'minecraft:music.missing',
        })
      }
      expect(yield* recorded.musicPlayed).toHaveLength(1)
      expect(yield* recorded.backend.isToneActive({ id: 1 })).toBe(true)
    }),
  )

  it.effect('stops when disabled or when the current sample has ended', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness()
      yield* tickToStart(player)
      yield* recorded.backend.stopTone({ id: 1 })

      const ended = yield* player.tick(START_INPUT)
      expect(ended.soundId).toBeNull()
      expect(ended.plan.state.currentSound).toBeNull()

      yield* tickToStart(player)
      const disabled = yield* player.tick({ ...START_INPUT, enabled: false })
      expect(disabled.soundId).toBeNull()
      expect(yield* recorded.backend.isToneActive({ id: 2 })).toBe(false)
    }),
  )

  it.effect('does not ask a locked or unavailable backend to play', () =>
    Effect.gen(function* () {
      for (const availability of ['locked', 'unavailable'] as const) {
        const { player, recorded } = yield* makeHarness(availability)
        const result = yield* player.tick(START_INPUT)

        expect(result.played).toBe(false)
        expect(yield* recorded.musicPlayed).toHaveLength(0)
        yield* player.stop
      }
    }),
  )

  it.effect('reports a backend refusal without applying the music start', () =>
    Effect.gen(function* () {
      const recorded = yield* makeRecordingBackend('ready')
      const refusingBackend: AudioBackend = {
        ...recorded.backend,
        playMusic: () => Effect.succeed({ accepted: false, id: 1 }),
      }
      const player = yield* makeMinecraftMusicPlayer(REGISTRY, () => 0).pipe(
        Effect.provide(Layer.succeed(AudioBackendPort, refusingBackend)),
      )

      const result = yield* tickToStart(player)

      expect(result.played).toBe(false)
      expect(result.soundId).toBeNull()
      expect(result.plan.state.currentSound).toBeNull()
      yield* player.stop
    }),
  )

  it.effect('turns a synchronous music backend throw into a typed playback error', () =>
    Effect.gen(function* () {
      const recorded = yield* makeRecordingBackend('ready')
      const throwingBackend: AudioBackend = {
        ...recorded.backend,
        playMusic: () => {
          throw new Error('synchronous music backend failure')
        },
      }
      const player = yield* makeMinecraftMusicPlayer(REGISTRY, () => 0).pipe(
        Effect.provide(Layer.succeed(AudioBackendPort, throwingBackend)),
      )

      const result = yield* Effect.either(tickToStart(player))

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({
          _tag: 'MinecraftMusicPlaybackError',
          soundId: 'minecraft:music/free_game',
        })
      }
      yield* player.stop
    }),
  )

  it.effect('handles non-finite randomness at the player boundary', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness('ready', () => Number.NaN)
      const result = yield* tickToStart(player)

      expect(result.played).toBe(true)
      expect(yield* recorded.musicPlayed).toHaveLength(1)
    }),
  )

  it.effect('forwards resolved volume, pitch, and streaming metadata', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness('ready', () => 0, METADATA_REGISTRY)
      yield* tickToStart(player)

      expect(yield* recorded.musicPlayed).toStrictEqual([
        { gain: 0.5, playbackRate: 1.25, soundId: 'minecraft:music/free_game', stream: true },
      ])
    }),
  )

  it.effect('forwards official variant volumes above unity', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness('ready', () => 0, LOUD_METADATA_REGISTRY)
      yield* tickToStart(player)

      expect(yield* recorded.musicPlayed).toStrictEqual([
        { gain: 4, playbackRate: 1.25, soundId: 'minecraft:music/free_game', stream: true },
      ])
    }),
  )
})

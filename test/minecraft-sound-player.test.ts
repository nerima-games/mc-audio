import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Ref, Result } from 'effect'
import { FixedClockLayer } from '@nerima-games/mc-kernel/domain/clock'
import { EpochMillis, MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'
import { PositionAxis, type Position } from '@nerima-games/mc-kernel/domain/coordinates'
import { AngleRadians } from '@nerima-games/mc-kernel/domain/shared-vocabulary'
import {
  AudioDurationSecs,
  AudioDistance,
  AudioFrequencyHz,
  AudioGain,
  AudioHandleId,
  AudioSampleId,
  AudioVolume,
  MinecraftSoundEventId,
  MinecraftSoundNamespace,
} from '../src/domain/audio-brands'
import {
  type AudioBackend,
  type AudioAvailability,
  AudioBackendPort,
  makeRecordingBackend,
} from '../src/domain/backend-port'
import type { CaptionEvent } from '../src/domain/caption'
import {
  makeMinecraftSoundPlayer,
  planMinecraftSound,
  type MinecraftSoundPlayOptions,
} from '../src/domain/minecraft-sound-player'
import { parseMinecraftSoundsJson } from '../src/domain/minecraft-sounds'
import { recordingCaptionLayer } from '../src/domain/engine'
import { spatialise } from '../src/domain/volume'
import { makeWebAudioBackend } from '../src/domain/webaudio-adapter'
import { makeFakeWebAudio } from './fake-webaudio'

const success = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isSuccess(result)) {
    return result.success
  }
  throw new Error('Expected a successful result')
}

const position = (x: number, y: number, z: number): Position => ({
  x: PositionAxis(x),
  y: PositionAxis(y),
  z: PositionAxis(z),
})

const soundEventId = (id: string) => MinecraftSoundEventId(id)

const REGISTRY = success(parseMinecraftSoundsJson(
  {
    'block.break': {
      subtitle: 'subtitles.block.break',
      sounds: [
        { name: 'block/stone', volume: 0.5, pitch: 2, attenuation_distance: 24 },
        { name: 'block/wood', volume: 1, pitch: 1.5 },
      ],
    },
    'block.firefly_bush.idle': {
      sounds: [{ name: 'block/firefly_bush/idle', volume: 4 }],
    },
    'ui.click': { sounds: ['ui/click'] },
    'music.stream': { sounds: [{ name: 'music/stream', stream: true }] },
  },
  { namespace: MinecraftSoundNamespace('minecraft') },
))

const planSound = (id: string, options: Parameters<typeof planMinecraftSound>[2] = {}) =>
  success(planMinecraftSound(REGISTRY, soundEventId(id), options))

const LISTENER = position(0, 64, 0)
const CAMERA = {
  capturedAtSecs: MonotonicTimeSecs(5),
  pitchRadians: AngleRadians(0),
  position: LISTENER,
  yawRadians: AngleRadians(0),
}

const makeHarness = (
  availability: AudioAvailability,
  randomSource: () => number = () => 0,
) =>
  Effect.gen(function* makeHarnessEffect() {
    const recorded = yield* makeRecordingBackend(availability)
    const captionLog = yield* Ref.make<ReadonlyArray<CaptionEvent>>([])
    const dependencies = Layer.merge(
      Layer.merge(
        Layer.succeed(AudioBackendPort, recorded.backend),
        recordingCaptionLayer((event) => Ref.update(captionLog, (current) => [...current, event])),
      ),
      FixedClockLayer({
        monotonicSecs: MonotonicTimeSecs(5),
        wallClockEpochMillis: EpochMillis(0),
      }),
    )
    const player = yield* makeMinecraftSoundPlayer(REGISTRY, randomSource).pipe(
      Effect.provide(dependencies),
    )

    return { captionLog, player, recorded }
  })

describe('Minecraft sound player', () => {
  it('builds a backend request from the resolved event data', () => {
    const plan = planSound('minecraft:block.break', {
      random: 0,
      position: position(12, 64, 0),
      listener: LISTENER,
      sfxVolume: AudioVolume(0.8),
      gainScale: AudioGain(0.5),
      frequency: AudioFrequencyHz(880),
      durationSecs: AudioDurationSecs(0.25),
    })

    expect(plan).toMatchObject({
      eventId: 'minecraft:block.break',
      subtitle: 'subtitles.block.break',
      sound: {
        soundId: 'minecraft:block/stone',
        volume: 0.5,
        pitch: 2,
        attenuationDistance: 24,
      },
      request: {
        soundId: 'minecraft:block/stone',
        playbackRate: 2,
        gain: 0.1,
        pan: 0.5,
        loop: false,
        frequency: 880,
        durationSecs: 0.25,
        naturalDuration: false,
      },
    })
  })

  it('preserves an official variant volume above unity in the backend request', () => {
    const plan = planSound('minecraft:block.firefly_bush.idle', {
      listener: LISTENER,
      position: LISTENER,
      sfxVolume: AudioVolume(1),
      gainScale: AudioGain(1),
    })

    expect(plan.request.gain).toBe(4)
  })

  it('uses safe defaults for missing optional playback values', () => {
    const plan = planSound('minecraft:block.break', {
      loop: true,
    })
    expect(Option.isNone(AudioFrequencyHz.option(0))).toBe(true)
    expect(Option.isNone(AudioDurationSecs.option(Number.NaN))).toBe(true)

    expect(plan.request).toMatchObject({
      frequency: 440,
      durationSecs: 0.12,
      gain: 0.5,
      loop: true,
      pan: 0,
    })
    expect(planSound('minecraft:ui.click').subtitle).toBeNull()
  })

  it('rejects malformed frequency and duration values before building a request', () => {
    const invalidFrequency = planMinecraftSound(REGISTRY, soundEventId('minecraft:block.break'), {
      // @ts-expect-error Simulate invalid playback options from an untyped JavaScript caller.
      frequency: 0,
    })
    const invalidDuration = planMinecraftSound(REGISTRY, soundEventId('minecraft:block.break'), {
      // @ts-expect-error Simulate invalid playback options from an untyped JavaScript caller.
      durationSecs: Number.NaN,
    })
    const invalidEnabled = planMinecraftSound(REGISTRY, soundEventId('minecraft:block.break'), {
      // @ts-expect-error Simulate invalid playback options from an untyped JavaScript caller.
      enabled: null,
    })

    expect(Result.isFailure(invalidFrequency)).toBe(true)
    if (Result.isFailure(invalidFrequency)) {
      expect(invalidFrequency.failure).toMatchObject({
        _tag: 'MinecraftSoundPlayOptionsFailure',
        field: 'frequency',
      })
    }
    expect(Result.isFailure(invalidDuration)).toBe(true)
    if (Result.isFailure(invalidDuration)) {
      expect(invalidDuration.failure).toMatchObject({
        _tag: 'MinecraftSoundPlayOptionsFailure',
        field: 'durationSecs',
      })
    }
    expect(Result.isFailure(invalidEnabled)).toBe(true)
    if (Result.isFailure(invalidEnabled)) {
      expect(invalidEnabled.failure).toMatchObject({
        _tag: 'MinecraftSoundPlayOptionsFailure',
        field: 'enabled',
      })
    }
  })

  it('lets streamed Minecraft sounds finish at their natural duration', () => {
    expect(planSound('minecraft:music.stream').request).toMatchObject({
      soundId: 'minecraft:music/stream',
      stream: true,
      naturalDuration: true,
    })
    expect(planSound('minecraft:ui.click').request.naturalDuration).toBe(false)
  })

  it.effect('emits a subtitle and plays the selected decoded sound when ready', () =>
    Effect.gen(function* () {
      const { captionLog, player, recorded } = yield* makeHarness('ready')
      const playback = yield* player.play(soundEventId('minecraft:block.break'), {
        camera: CAMERA,
        random: 0,
        position: position(12, 64, 0),
      })

      expect(playback.played).toBe(true)
      expect(playback.handle).toStrictEqual({ id: 1 })
      expect(yield* Ref.get(captionLog)).toStrictEqual([
        {
          cueId: 'minecraft:block.break',
          text: 'subtitles.block.break',
          atSecs: MonotonicTimeSecs(5),
          reason: 'audible',
          pan: 0.5,
        },
      ])
      expect(yield* recorded.played).toStrictEqual([
        expect.objectContaining({
          soundId: 'minecraft:block/stone',
          playbackRate: 2,
          gain: 0.25,
          pan: 0.5,
        }),
      ])

      yield* player.stop(playback)
    }),
  )

  it.effect('uses the injected random source when the caller does not provide one', () =>
    Effect.gen(function* () {
      const { player, recorded } = yield* makeHarness('ready', () => 0.99)
      const playback = yield* player.play(soundEventId('minecraft:block.break'))

      expect(playback.sound.soundId).toBe('minecraft:block/wood')
      expect(yield* recorded.played).toStrictEqual([
        expect.objectContaining({ soundId: 'minecraft:block/wood', playbackRate: 1.5 }),
      ])
    }),
  )

  it.effect('keeps subtitles while each audio gate explains why playback was skipped', () =>
    Effect.gen(function* () {
      const scenarios: ReadonlyArray<{
        readonly availability: AudioAvailability
        readonly options: MinecraftSoundPlayOptions
        readonly reason: CaptionEvent['reason']
      }> = [
        { availability: 'ready', options: { enabled: false }, reason: 'muted' },
        { availability: 'locked', options: {}, reason: 'gate-blocked' },
        { availability: 'unavailable', options: {}, reason: 'unavailable' },
      ]

      for (const scenario of scenarios) {
        const { captionLog, player, recorded } = yield* makeHarness(scenario.availability)
        const playback = yield* player.play(soundEventId('minecraft:block.break'), scenario.options)

        expect(playback).toMatchObject({ played: false, handle: null })
        expect(yield* recorded.played).toHaveLength(0)
        expect(yield* Ref.get(captionLog)).toMatchObject([{ reason: scenario.reason }])
        yield* player.stop(playback)
      }
    }),
  )

  it.effect('plays uncaptioned UI events without inventing a subtitle', () =>
    Effect.gen(function* () {
      const { captionLog, player, recorded } = yield* makeHarness('ready')
      const playback = yield* player.play(soundEventId('minecraft:ui.click'))

      expect(playback.played).toBe(true)
      expect(yield* Ref.get(captionLog)).toHaveLength(0)
      expect(yield* recorded.played).toStrictEqual([
        expect.objectContaining({ soundId: 'minecraft:ui/click', pan: 0 }),
      ])
    }),
  )

  it.effect('reports a backend refusal as a skipped sound', () =>
    Effect.gen(function* () {
      const recorded = yield* makeRecordingBackend('ready')
      const refusingBackend: AudioBackend = {
        ...recorded.backend,
        playTone: () => Effect.succeed({ accepted: false, id: AudioHandleId(1) }),
      }
      const captionLog = yield* Ref.make<ReadonlyArray<CaptionEvent>>([])
      const dependencies = Layer.merge(
        Layer.merge(
          Layer.succeed(AudioBackendPort, refusingBackend),
          recordingCaptionLayer((event) => Ref.update(captionLog, (current) => [...current, event])),
        ),
        FixedClockLayer({
          monotonicSecs: MonotonicTimeSecs(5),
          wallClockEpochMillis: EpochMillis(0),
        }),
      )
      const player = yield* makeMinecraftSoundPlayer(REGISTRY, () => 0).pipe(
        Effect.provide(dependencies),
      )

      const playback = yield* player.play(soundEventId('minecraft:block.break'), {
        camera: CAMERA,
        random: 0,
        position: position(12, 64, 0),
      })

      expect(playback.played).toBe(false)
      expect(playback.handle).toBeNull()
      expect(yield* recorded.played).toHaveLength(0)
      expect(yield* Ref.get(captionLog)).toHaveLength(1)
    }),
  )

  it.effect('loads a manifest-backed sample on the first high-level play', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio({ decodedDurationSecs: 0.25 })
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        sampleManifest: new Map([
          [AudioSampleId('minecraft:ui/click'), { data: new ArrayBuffer(4), kind: 'array-buffer' as const }],
        ]),
      })
      yield* audio.unlock

      const captionLog = yield* Ref.make<ReadonlyArray<CaptionEvent>>([])
      const dependencies = Layer.merge(
        Layer.merge(
          Layer.succeed(AudioBackendPort, audio),
          recordingCaptionLayer((event) => Ref.update(captionLog, (current) => [...current, event])),
        ),
        FixedClockLayer({
          monotonicSecs: MonotonicTimeSecs(5),
          wallClockEpochMillis: EpochMillis(0),
        }),
      )
      const player = yield* makeMinecraftSoundPlayer(REGISTRY, () => 0).pipe(
        Effect.provide(dependencies),
      )

      expect((yield* player.play(soundEventId('minecraft:ui.click'))).played).toBe(true)
      expect(fake.context()?.decodedData).toHaveLength(1)
      expect(fake.context()?.bufferSources).toHaveLength(1)
      expect(fake.context()?.oscillators).toHaveLength(0)
      expect(yield* Ref.get(captionLog)).toHaveLength(0)

      yield* audio.dispose
    }),
  )

  it.effect('returns a typed error for an unknown event', () =>
    Effect.gen(function* () {
      const { player } = yield* makeHarness('ready')
      const result = yield* player.play(soundEventId('minecraft:missing')).pipe(
        Effect.catch((cause) => Effect.succeed(cause)),
      )

      expect(result).toMatchObject({
        _tag: 'MinecraftSoundPlaybackError',
        eventId: 'minecraft:missing',
      })
    }),
  )

  it.effect('rejects null enabled before playback or captions', () =>
    Effect.gen(function* () {
      const { captionLog, player, recorded } = yield* makeHarness('ready')
      const result = yield* player
        .play(soundEventId('minecraft:block.break'), {
          // @ts-expect-error Simulate invalid playback options from an untyped JavaScript caller.
          enabled: null,
        })
        .pipe(Effect.catch((cause) => Effect.succeed(cause)))

      expect(result).toMatchObject({
        _tag: 'MinecraftSoundPlaybackError',
        eventId: 'minecraft:block.break',
        cause: {
          _tag: 'MinecraftSoundPlayOptionsFailure',
          field: 'enabled',
        },
      })
      expect(yield* recorded.played).toHaveLength(0)
      expect(yield* Ref.get(captionLog)).toHaveLength(0)
    }),
  )
})

describe('custom sound attenuation distance', () => {
  it('falls back to the default scale when the supplied scale is unusable', () => {
    expect(spatialise(LISTENER, position(12, 64, 0), { distanceScale: AudioDistance(0) })).toStrictEqual({
      gain: 0.5,
      pan: 1,
    })
    expect(Option.isNone(AudioDistance.option(Number.NaN))).toBe(true)
    expect(spatialise(LISTENER, position(12, 64, 0), { distanceScale: AudioDistance(0) })).toStrictEqual({
      gain: 0.5,
      pan: 1,
    })
  })
})

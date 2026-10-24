import { Effect, Layer, Option, Result } from 'effect'
import type { CameraPoseSnapshot } from '@nerima-games/mc-kernel/domain/camera'
import { PositionAxis, type Position } from '@nerima-games/mc-kernel/domain/coordinates'
import { MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'
import { AngleRadians } from '@nerima-games/mc-kernel/domain/shared-vocabulary'
import { AudioTick, MinecraftSoundEventId, MinecraftSoundNamespace } from '../src/domain/audio-brands.js'
import {
  type AudioAvailability,
  AudioBackendPort,
  makeRecordingBackend,
  type RecordedBackend,
} from '../src/domain/backend-port.js'
import {
  initialMinecraftAmbientSoundsState,
  planMinecraftAmbientSounds,
  type MinecraftAmbientSoundsPlan,
  type MinecraftAmbientSoundsPlannerInput,
  type MinecraftAmbientSoundsState,
} from '../src/domain/minecraft-ambient-sounds.js'
import {
  makeMinecraftAmbientSoundsPlayer,
  type MinecraftAmbientSoundsPlayer,
} from '../src/domain/minecraft-ambient-sounds-player.js'
import { parseMinecraftSoundsJson } from '../src/domain/minecraft-sounds.js'
import type { MinecraftSoundRegistry } from '../src/domain/minecraft-sounds-types.js'

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
export const REGISTRY: MinecraftSoundRegistry = registryResult.success

export const LISTENER: Position = { x: PositionAxis(0), y: PositionAxis(64), z: PositionAxis(0) }
export const CAMERA: CameraPoseSnapshot = {
  capturedAtSecs: MonotonicTimeSecs(5),
  pitchRadians: AngleRadians(0),
  position: LISTENER,
  yawRadians: AngleRadians(0),
}
export const MOOD_POSITION: Position = { x: PositionAxis(6), y: PositionAxis(64), z: PositionAxis(0) }
export const LISTENER_FORWARD: Position = { x: PositionAxis(0), y: PositionAxis(0), z: PositionAxis(-1) }

export const asDefinition = (value: unknown): unknown => value

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

const requiredSound = (value: string): MinecraftSoundEventId => {
  const sound = MinecraftSoundEventId.option(value)
  if (Option.isNone(sound)) {
    throw new Error(`Test fixture sound id is invalid: ${value}`)
  }
  return sound.value
}

export const state = (overrides: StateOverrides = {}): MinecraftAmbientSoundsState => {
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
export const plan = (
  overrides: PlannerOverrides = {},
): MinecraftAmbientSoundsPlan =>
  (() => {
    const result = planMinecraftAmbientSounds({
      cameraPosition: LISTENER,
      definition: null,
      moodPosition: null,
      randomSource: () => 0,
      state: state(),
      ...overrides,
      tick: requiredTick(overrides.tick ?? 0),
    })
    if (Result.isFailure(result)) {
      throw result.failure
    }
    return result.success
  })()

export const makeHarness = (
  availability: AudioAvailability = 'ready',
  randomSource: () => number = () => 0,
): Effect.Effect<{ readonly player: MinecraftAmbientSoundsPlayer; readonly recorded: RecordedBackend }> =>
  Effect.gen(function* makeHarnessEffect() {
    const recorded = yield* makeRecordingBackend(availability)
    const player = yield* makeMinecraftAmbientSoundsPlayer(REGISTRY, randomSource).pipe(
      Effect.provide(Layer.succeed(AudioBackendPort, recorded.backend)),
    )
    return { player, recorded }
  })

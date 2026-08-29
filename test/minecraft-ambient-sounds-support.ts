import { Effect, Layer } from 'effect'
import { MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import {
  type AudioAvailability,
  AudioBackendPort,
  makeRecordingBackend,
} from '../src/domain/backend-port.js'
import {
  initialMinecraftAmbientSoundsState,
  planMinecraftAmbientSounds,
  type MinecraftAmbientSoundsDefinition,
  type MinecraftAmbientSoundsPlannerInput,
  type MinecraftAmbientSoundsState,
} from '../src/domain/minecraft-ambient-sounds.js'
import { makeMinecraftAmbientSoundsPlayer } from '../src/domain/minecraft-ambient-sounds-player.js'
import { parseMinecraftSoundsJson } from '../src/domain/minecraft-sounds.js'

export const REGISTRY = parseMinecraftSoundsJson(
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

export const LISTENER = { x: 0, y: 64, z: 0 }
export const CAMERA = {
  capturedAtSecs: MonotonicTimeSecs(5),
  pitchRadians: 0,
  position: LISTENER,
  yawRadians: 0,
}
export const MOOD_POSITION = { x: 6, y: 64, z: 0 }
export const LISTENER_FORWARD = { x: 0, y: 0, z: -1 }

export const asDefinition = (value: unknown): MinecraftAmbientSoundsDefinition =>
  value as MinecraftAmbientSoundsDefinition

export const state = (overrides: Partial<MinecraftAmbientSoundsState> = {}): MinecraftAmbientSoundsState => ({
  ...initialMinecraftAmbientSoundsState(),
  ...overrides,
})

export const plan = (overrides: Partial<MinecraftAmbientSoundsPlannerInput> = {}) =>
  planMinecraftAmbientSounds({
    cameraPosition: LISTENER,
    definition: null,
    randomSource: () => 0,
    state: state(),
    tick: 0,
    ...overrides,
  } as MinecraftAmbientSoundsPlannerInput)

export const makeHarness = (
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

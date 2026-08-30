import { Effect, Layer } from 'effect'
import { type CameraPoseSnapshot, MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import {
  type AudioAvailability,
  AudioBackendPort,
  makeRecordingBackend,
  type RecordedBackend,
} from '../src/domain/backend-port.js'
import {
  initialMinecraftAmbientSoundsState,
  planMinecraftAmbientSounds,
  type MinecraftAmbientSoundsDefinition,
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

export const REGISTRY: MinecraftSoundRegistry = parseMinecraftSoundsJson(
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
export const CAMERA: CameraPoseSnapshot = {
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

export const plan = (
  overrides: Partial<MinecraftAmbientSoundsPlannerInput> = {},
): MinecraftAmbientSoundsPlan =>
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
): Effect.Effect<{ readonly player: MinecraftAmbientSoundsPlayer; readonly recorded: RecordedBackend }> =>
  Effect.gen(function* makeHarnessEffect() {
    const recorded = yield* makeRecordingBackend(availability)
    const player = yield* makeMinecraftAmbientSoundsPlayer(REGISTRY, randomSource).pipe(
      Effect.provide(Layer.succeed(AudioBackendPort, recorded.backend)),
    )
    return { player, recorded }
  })

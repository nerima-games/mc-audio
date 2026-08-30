import {
  type AudioBackend,
  AudioBackendPort,
  type ToneHandle,
  type TonePlayback,
  type ToneRequest,
} from './backend-port.js'
import { type CameraPoseSnapshot, type Position } from '@nerima-games/mc-kernel'
import { Effect, Ref } from 'effect'
import {
  type MinecraftAmbientMoodResolver,
  type MinecraftAmbientSoundsCommand,
  type MinecraftAmbientSoundsDefinition,
  type MinecraftAmbientSoundsPlan,
  type MinecraftAmbientSoundsPlannerInput,
  initialMinecraftAmbientSoundsState,
  planMinecraftAmbientSounds,
} from './minecraft-ambient-sounds.js'
import {
  type MinecraftSoundRegistry,
  type ResolvedMinecraftSound,
  resolveMinecraftSound,
} from './minecraft-sounds.js'
import {
  NO_SPATIALISATION,
  type Spatialisation,
  clamp01,
  clampNonNegative,
  minecraftSpatialise,
  spatialise,
} from './volume.js'

const AMBIENT_DURATION_SECS = 1
const AMBIENT_FREQUENCY = 20
const DEFAULT_AMBIENT_VOLUME = 1

const isMissing = (value: unknown): value is undefined => Object.is(value, globalThis.undefined)

const definitionForTick = (
  options: MinecraftAmbientSoundsTickOptions,
): MinecraftAmbientSoundsDefinition | null => {
  if (options.enabled === false) {
    return null
  }
  return options.definition ?? null
}

const plannerInputForTick = (
  options: MinecraftAmbientSoundsTickOptions,
  randomSource: MinecraftAmbientSoundsPlannerInput['randomSource'],
  state: MinecraftAmbientSoundsPlannerInput['state'],
): MinecraftAmbientSoundsPlannerInput => {
  const input = {
    cameraPosition: options.camera?.position ?? options.listener,
    definition: definitionForTick(options),
    moodPosition: options.moodPosition ?? null,
    randomSource,
    state,
    tick: options.tick,
  }
  if (options.moodResolver) {
    return { ...input, moodResolver: options.moodResolver }
  }
  return input
}

export type MinecraftAmbientSoundsTickOptions = {
  readonly ambientVolume?: number
  readonly definition?: MinecraftAmbientSoundsDefinition | null
  readonly enabled?: boolean
  readonly listener: Position
  readonly camera?: CameraPoseSnapshot
  readonly listenerForward?: Position
  readonly moodPosition?: Position | null
  readonly moodResolver?: MinecraftAmbientMoodResolver
  readonly tick: number
}

export type MinecraftAmbientSoundsPlayback = {
  readonly plan: MinecraftAmbientSoundsPlan
  readonly playedSoundIds: readonly string[]
}

export type MinecraftAmbientSoundsPlaybackError = {
  readonly _tag: 'MinecraftAmbientSoundsPlaybackError'
  readonly cause: unknown
  readonly soundId: string
}

export type MinecraftAmbientSoundsPlayer = {
  readonly tick: (
    options: MinecraftAmbientSoundsTickOptions,
  ) => Effect.Effect<MinecraftAmbientSoundsPlayback, MinecraftAmbientSoundsPlaybackError>
  readonly stop: Effect.Effect<void>
}

const ambientGain = (sound: ResolvedMinecraftSound, spatial: Spatialisation, volume: number): number =>
  clampNonNegative(clamp01(volume) * sound.volume * spatial.gain)

const ambientRequest = (input: {
  readonly loop: boolean
  readonly sound: ResolvedMinecraftSound
  readonly spatial: Spatialisation
  readonly volume: number
}): ToneRequest => ({
  durationSecs: AMBIENT_DURATION_SECS,
  frequency: AMBIENT_FREQUENCY,
  gain: ambientGain(input.sound, input.spatial, input.volume),
  loop: input.loop,
  naturalDuration: true,
  pan: input.spatial.pan,
  playbackRate: input.sound.pitch,
  sampleOnly: true,
  soundId: input.sound.soundId,
  stream: input.sound.stream,
})

const playbackError = (soundId: string, cause: unknown): MinecraftAmbientSoundsPlaybackError => ({
  _tag: 'MinecraftAmbientSoundsPlaybackError',
  cause,
  soundId,
})

type AppliedAmbientCommand = {
  readonly handle: ToneHandle | null
  readonly soundId: string | null
}

type AppliedAmbientPlan = {
  readonly loopSound: string | null
  readonly playedSoundIds: readonly string[]
}

type AmbientPlayCommand = Exclude<MinecraftAmbientSoundsCommand, { readonly kind: 'stop-loop' }>

const stopAmbientLoop = ({
  backend,
  loopHandleRef,
}: {
  readonly backend: AudioBackend
  readonly loopHandleRef: Ref.Ref<ToneHandle | null>
}): Effect.Effect<void> =>
  Effect.gen(function* stopMinecraftAmbientLoop() {
    const handle = yield* Ref.get(loopHandleRef)
    if (handle !== null) {
      yield* backend.stopTone(handle)
      yield* Ref.set(loopHandleRef, null)
    }
  })

const recordAmbientPlayback = (
  applied: AppliedAmbientCommand,
  startedHandles: ToneHandle[],
  playedSoundIds: string[],
): void => {
  if (applied.handle !== null) {
    startedHandles.push(applied.handle)
  }
  if (applied.soundId !== null) {
    playedSoundIds.push(applied.soundId)
  }
}

const loopSoundForCommand = (
  command: MinecraftAmbientSoundsCommand,
  applied: AppliedAmbientCommand,
  currentLoopSound: string | null,
): string | null => {
  if (command.kind !== 'start-loop') {
    return currentLoopSound
  }
  if (applied.handle === null) {
    return null
  }
  return command.sound
}

const spatialForMood = (input: {
  readonly listener: Position
  readonly listenerForward: Position | undefined
  readonly offset: number
  readonly position: Position
  readonly sound: ResolvedMinecraftSound
  readonly useMinecraftAttenuation: boolean
}): Spatialisation => {
  let spatialiseMood = spatialise
  if (input.useMinecraftAttenuation) {
    spatialiseMood = minecraftSpatialise
  }
  if (isMissing(input.listenerForward)) {
    return spatialiseMood(input.listener, input.position, {
      distanceOffset: input.offset,
      distanceScale: input.sound.attenuationDistance,
    })
  }
  return spatialiseMood(input.listener, input.position, {
    distanceOffset: input.offset,
    distanceScale: input.sound.attenuationDistance,
    listenerForward: input.listenerForward,
  })
}

const spatialForCommand = (
  command: MinecraftAmbientSoundsCommand,
  sound: ResolvedMinecraftSound,
  options: MinecraftAmbientSoundsTickOptions,
): Spatialisation => {
  if (command.kind !== 'play') {
    return NO_SPATIALISATION
  }
  if (command.category !== 'mood') {
    return NO_SPATIALISATION
  }
  return spatialForMood({
    listener: options.camera?.position ?? options.listener,
    listenerForward: options.listenerForward,
    offset: command.offset,
    position: command.position,
    sound,
    useMinecraftAttenuation: !isMissing(options.moodResolver),
  })
}

export const makeMinecraftAmbientSoundsPlayer = (
  registry: MinecraftSoundRegistry,
  randomSource: () => number,
): Effect.Effect<MinecraftAmbientSoundsPlayer, never, AudioBackendPort> =>
  Effect.gen(function* buildMinecraftAmbientSoundsPlayer() {
    const backend = yield* AudioBackendPort
    const stateRef = yield* Ref.make(initialMinecraftAmbientSoundsState())
    const loopHandleRef = yield* Ref.make<ToneHandle | null>(null)

    const resolveAmbientCommandSound = (
      command: AmbientPlayCommand,
    ): Effect.Effect<ResolvedMinecraftSound, MinecraftAmbientSoundsPlaybackError> =>
      Effect.try({
        catch: (cause): MinecraftAmbientSoundsPlaybackError => playbackError(command.sound, cause),
        try: () => resolveMinecraftSound(registry, command.sound, randomSource()),
      })

    const applyAmbientPlayCommand = (
      command: AmbientPlayCommand,
      options: MinecraftAmbientSoundsTickOptions,
      volume: number,
    ): Effect.Effect<AppliedAmbientCommand, MinecraftAmbientSoundsPlaybackError> =>
      Effect.gen(function* applyMinecraftAmbientPlayCommand() {
        const sound = yield* resolveAmbientCommandSound(command)
        const playback: TonePlayback = yield* backend.playTone(
          ambientRequest({
            loop: command.kind === 'start-loop',
            sound,
            spatial: spatialForCommand(command, sound, options),
            volume,
          }),
        )
        if (!playback.accepted) {
          return { handle: null, soundId: null }
        }
        const handle: ToneHandle = { id: playback.id }
        if (command.kind === 'start-loop') {
          yield* Ref.set(loopHandleRef, handle)
        }
        return { handle, soundId: sound.soundId }
      })

    const applyAmbientCommand = (
      command: MinecraftAmbientSoundsCommand,
      options: MinecraftAmbientSoundsTickOptions,
      volume: number,
    ): Effect.Effect<AppliedAmbientCommand, MinecraftAmbientSoundsPlaybackError> =>
      Effect.gen(function* applyMinecraftAmbientCommand() {
        if (command.kind === 'stop-loop') {
          yield* stopAmbientLoop({ backend, loopHandleRef })
          return { handle: null, soundId: null }
        }
        return yield* applyAmbientPlayCommand(command, options, volume)
      })

    const applyPlan = (
      plan: MinecraftAmbientSoundsPlan,
      options: MinecraftAmbientSoundsTickOptions,
    ): Effect.Effect<AppliedAmbientPlan, MinecraftAmbientSoundsPlaybackError> =>
      Effect.gen(function* applyMinecraftAmbientPlan() {
        const previousLoopHandle = yield* Ref.get(loopHandleRef)
        const startedHandles: ToneHandle[] = []
        let loopWasStopped = false
        const { loopSound: plannedLoopSound } = plan.state
        let loopSound = plannedLoopSound
        const playedSoundIds: string[] = []
        const volume = options.ambientVolume ?? DEFAULT_AMBIENT_VOLUME
        return yield* Effect.gen(function* applyMinecraftAmbientCommands() {
          for (const command of plan.commands) {
            if (command.kind === 'stop-loop') {
              loopWasStopped = true
              loopSound = null
            }
            const applied = yield* applyAmbientCommand(command, options, volume)
            recordAmbientPlayback(applied, startedHandles, playedSoundIds)
            loopSound = loopSoundForCommand(command, applied, loopSound)
          }
          return { loopSound, playedSoundIds }
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* rollbackMinecraftAmbientCommands() {
              for (const handle of startedHandles) {
                yield* backend.stopTone(handle)
              }
              if (loopWasStopped) {
                yield* Ref.set(loopHandleRef, null)
              } else {
                yield* Ref.set(loopHandleRef, previousLoopHandle)
              }
              return yield* Effect.fail(error)
            }),
          ),
        )
      })

    const reset = (): Effect.Effect<void> =>
      Effect.gen(function* resetMinecraftAmbientSounds() {
        yield* stopAmbientLoop({ backend, loopHandleRef })
        yield* Ref.set(stateRef, initialMinecraftAmbientSoundsState())
      })

    const tickReady = (
      options: MinecraftAmbientSoundsTickOptions,
    ): Effect.Effect<MinecraftAmbientSoundsPlayback, MinecraftAmbientSoundsPlaybackError> =>
      Effect.gen(function* tickReadyMinecraftAmbientSounds() {
        const state = yield* Ref.get(stateRef)
        const plan = planMinecraftAmbientSounds(plannerInputForTick(options, randomSource, state))
        const applied = yield* applyPlan(plan, options)
        const appliedPlan = { ...plan, state: { ...plan.state, loopSound: applied.loopSound } }
        yield* Ref.set(stateRef, appliedPlan.state)
        return { plan: appliedPlan, playedSoundIds: applied.playedSoundIds }
      })

    return {
      stop: reset(),
      tick: (options: MinecraftAmbientSoundsTickOptions) =>
        Effect.gen(function* tickMinecraftAmbientSounds() {
          const availability = yield* backend.availability
          if (availability !== 'ready') {
            yield* reset()
            const state = initialMinecraftAmbientSoundsState()
            return {
              plan: { commands: [], state },
              playedSoundIds: [],
            }
          }
          return yield* tickReady(options)
        }),
    }
  })

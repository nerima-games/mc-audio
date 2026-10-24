import {
  type AudioBackend,
  AudioBackendPort,
  type ToneHandle,
  type TonePlayback,
} from './backend-port.js'
import {
  type AudioGain,
  type AudioVolume,
  type MinecraftSoundEventId,
  type MinecraftSoundResourceId,
  AudioGain as makeAudioGain,
  AudioVolume as makeAudioVolume,
} from './audio-brands.js'
import { Effect, Ref } from 'effect'
import {
  type MinecraftBackgroundMusic,
  type MinecraftBiomeMusic,
  type MinecraftMusicContext,
  type MinecraftMusicDataFailure,
  type MinecraftMusicDefinition,
  type MinecraftMusicPlan,
  type MinecraftMusicState,
  initialMinecraftMusicState,
  planMinecraftMusic,
  resolveMinecraftBackgroundMusicDefinition,
  resolveMinecraftMusicDefinition,
  selectMinecraftBiomeMusicDefinition,
} from './minecraft-music.js'
import { type MinecraftSoundRegistry, resolveMinecraftSound } from './minecraft-sounds.js'
import type { ResolvedMinecraftSound } from './minecraft-sounds-types.js'
import { clampNonNegative } from './volume.js'

const DEFAULT_MUSIC_VOLUME_VALUE = 1
const DEFAULT_MUSIC_VOLUME = makeAudioVolume(DEFAULT_MUSIC_VOLUME_VALUE)
const RANDOM_UPPER_BOUND = DEFAULT_MUSIC_VOLUME - Number.EPSILON
const RANDOM_LOWER_BOUND = 0
const RANDOM_INTERVAL_STEP = Math.ceil(RANDOM_UPPER_BOUND - RANDOM_LOWER_BOUND)
const DEFAULT_ENABLED = true
const DEFAULT_MUSIC_GAIN_SCALE = 1

const isMissing = (value: unknown): value is undefined => Object.is(value, globalThis.undefined)

export type MinecraftMusicTickInput = {
  readonly context: MinecraftMusicContext
  readonly enabled?: boolean
  readonly musicVolume?: AudioVolume
  readonly backgroundMusic?: MinecraftBackgroundMusic | null
  readonly biomeMusic?: MinecraftBiomeMusic
  readonly definition?: MinecraftMusicDefinition | null
}

export type MinecraftMusicTickResult = {
  readonly plan: MinecraftMusicPlan
  readonly played: boolean
  readonly soundId: MinecraftSoundEventId | null
}

export type MinecraftMusicPlaybackError = {
  readonly _tag: 'MinecraftMusicPlaybackError'
  readonly cause: unknown
  readonly soundId: MinecraftSoundEventId | MinecraftSoundResourceId | null
}

export type MinecraftMusicPlayer = {
  readonly tick: (
    input: MinecraftMusicTickInput,
  ) => Effect.Effect<MinecraftMusicTickResult, MinecraftMusicPlaybackError>
  readonly stop: Effect.Effect<void>
}

const randomIntInclusive = (
  randomSource: () => unknown,
  min: number,
  max: number,
): number => {
  const sample = randomSource()
  let normalized = RANDOM_LOWER_BOUND
  if (typeof sample === 'number' && Number.isFinite(sample)) {
    normalized = Math.min(RANDOM_UPPER_BOUND, Math.max(RANDOM_LOWER_BOUND, sample))
  }
  return Math.floor(min + normalized * (max - min + RANDOM_INTERVAL_STEP))
}

const playbackError = (
  soundId: MinecraftSoundEventId | MinecraftSoundResourceId | null,
  cause: unknown,
): MinecraftMusicPlaybackError => ({
  _tag: 'MinecraftMusicPlaybackError',
  cause,
  soundId,
})

type MusicPlayerResources = {
  readonly backend: AudioBackend
  readonly gainScaleRef: Ref.Ref<number>
  readonly handleRef: Ref.Ref<ToneHandle | null>
  readonly stateRef: Ref.Ref<MinecraftMusicState>
}

type BiomeMusicSelection = {
  readonly definition: MinecraftMusicDefinition | null
  readonly source: MinecraftBiomeMusic
}

type MusicCommandApplierOptions = MusicPlayerResources & {
  readonly randomSource: () => unknown
  readonly registry: MinecraftSoundRegistry
}

type StartMusicCommandWithResolution = StartMusicCommand & {
  readonly resolved: ResolvedMinecraftSound
}

type ResolvedMusicCommand = Exclude<MinecraftMusicPlan['commands'][number], StartMusicCommand> | StartMusicCommandWithResolution

type StartMusicCommand = Extract<MinecraftMusicPlan['commands'][number], { readonly kind: 'start' }>

type AppliedMusicPlan = {
  readonly played: boolean
  readonly state: MinecraftMusicState
}

const stopActiveHandle = ({
  backend,
  gainScaleRef,
  handleRef,
}: Pick<MusicPlayerResources, 'backend' | 'gainScaleRef' | 'handleRef'>): Effect.Effect<void> =>
  Effect.gen(function* stopActiveHandleEffect() {
    const handle = yield* Ref.getAndSet(handleRef, null)
    if (handle !== null) {
      yield* backend.stopTone(handle)
    }
    yield* Ref.set(gainScaleRef, DEFAULT_MUSIC_GAIN_SCALE)
  })

const clearMusicPlaybackState = ({
  gainScaleRef,
  handleRef,
}: Pick<MusicPlayerResources, 'gainScaleRef' | 'handleRef'>): Effect.Effect<void> =>
  Effect.gen(function* clearMusicPlaybackStateEffect() {
    yield* Ref.set(handleRef, null)
    yield* Ref.set(gainScaleRef, DEFAULT_MUSIC_GAIN_SCALE)
  })

const stopCurrentMusic = ({ backend, gainScaleRef, handleRef, stateRef }: MusicPlayerResources): Effect.Effect<void> =>
  Effect.gen(function* stopCurrentMusicEffect() {
    yield* stopActiveHandle({ backend, gainScaleRef, handleRef })
    yield* Ref.set(stateRef, initialMinecraftMusicState())
  })

const makeMusicCommandApplier = ({
  backend,
  gainScaleRef,
  handleRef,
  randomSource,
  registry,
  stateRef,
}: MusicCommandApplierOptions): (
  plan: MinecraftMusicPlan,
) => Effect.Effect<AppliedMusicPlan, MinecraftMusicPlaybackError> => {
  const applyGainCommand = (gain: AudioVolume): Effect.Effect<void> =>
    Effect.gen(function* applyGainCommandEffect() {
      // Never null here: a 'gain' command is only planned when
      // `state.currentSound !== null`, and this player only ever sets that
      // Non-null in the same step it sets `handleRef` non-null; a refused or
      // Failed start resets both together (applyMusicCommands, applyMusicPlan).
      const currentHandle = yield* Ref.get(handleRef)
      const handle = yield* Effect.fromNullishOr(currentHandle).pipe(Effect.orDie)
      const scale = yield* Ref.get(gainScaleRef)
      yield* backend.setToneGain(handle, clampNonNegative(gain * scale))
    })

  const resolveStartCommand = (
    definition: StartMusicCommand,
  ): Effect.Effect<ResolvedMinecraftSound, MinecraftMusicPlaybackError> =>
    Effect.fromResult(resolveMinecraftSound(registry, definition.definition.sound, randomSource())).pipe(
      Effect.mapError((cause) => playbackError(definition.definition.sound, cause)),
    )

  const resolveStartCommands = (
    plan: MinecraftMusicPlan,
  ): Effect.Effect<ReadonlyArray<ResolvedMusicCommand>, MinecraftMusicPlaybackError> =>
    Effect.gen(function* resolveMinecraftStartCommands() {
      const resolvedCommands: ResolvedMusicCommand[] = []
      for (const command of plan.commands) {
        if (command.kind === 'start') {
          resolvedCommands.push({
            ...command,
            resolved: yield* resolveStartCommand(command),
          })
        } else {
          resolvedCommands.push(command)
        }
      }
      return resolvedCommands
    })

  const createStartMusicPlayback = (
    definition: StartMusicCommand,
    resolved: ResolvedMinecraftSound,
  ): Effect.Effect<{ readonly playback: TonePlayback; readonly resolvedVolume: AudioGain }, MinecraftMusicPlaybackError> =>
    Effect.gen(function* createStartMusicPlaybackEffect() {
      const resolvedVolume = clampNonNegative(resolved.volume)
      const gain = makeAudioGain(definition.gain * resolvedVolume)
      const playbackEffect = yield* Effect.try({
        catch: (cause): MinecraftMusicPlaybackError => playbackError(resolved.soundId, cause),
        try: () => backend.playMusic({
          gain,
          playbackRate: resolved.pitch,
          soundId: resolved.soundId,
          stream: resolved.stream,
        }),
      })
      const playback: TonePlayback = yield* playbackEffect
      return { playback, resolvedVolume }
    })

  const applyStartCommand = (
    definition: StartMusicCommand,
    resolved: ResolvedMinecraftSound,
  ): Effect.Effect<boolean, MinecraftMusicPlaybackError> =>
    Effect.gen(function* applyStartCommandEffect() {
      const { playback, resolvedVolume } = yield* createStartMusicPlayback(definition, resolved)
      if (!playback.accepted) {
        yield* clearMusicPlaybackState({ gainScaleRef, handleRef })
        return false
      }
      const handle: ToneHandle = { id: playback.id }
      yield* Ref.set(handleRef, handle)
      yield* Ref.set(gainScaleRef, resolvedVolume)
      return true
    })

  const applyMusicCommand = (
    command: ResolvedMusicCommand,
  ): Effect.Effect<boolean, MinecraftMusicPlaybackError> => {
    if (command.kind === 'stop') {
      return stopActiveHandle({ backend, gainScaleRef, handleRef }).pipe(Effect.as(false))
    }
    if (command.kind === 'gain') {
      return applyGainCommand(command.gain).pipe(Effect.as(false))
    }
    return applyStartCommand(command, command.resolved)
  }

  const applyMusicCommands = (
    plan: ReadonlyArray<ResolvedMusicCommand>,
  ): Effect.Effect<boolean, MinecraftMusicPlaybackError> =>
    Effect.gen(function* applyMinecraftMusicCommands() {
      let played = false
      for (const command of plan) {
        const commandPlayed = yield* applyMusicCommand(command)
        if (command.kind === 'start') {
          played = commandPlayed
          if (!played) {
            const state = initialMinecraftMusicState()
            yield* Ref.set(stateRef, state)
            return false
          }
        }
      }
      return played
    })

  return (plan) =>
    Effect.gen(function* applyMusicPlan() {
      const resolvedCommands = yield* resolveStartCommands(plan)
      const played = yield* applyMusicCommands(resolvedCommands)
      if (!played && plan.commands.some((command) => command.kind === 'start')) {
        return { played: false, state: initialMinecraftMusicState() }
      }
      yield* Ref.set(stateRef, plan.state)
      if (plan.state.currentSound === null) {
        yield* clearMusicPlaybackState({ gainScaleRef, handleRef })
      }
      return { played, state: plan.state }
    })
}

const resolveBackgroundMusicDefinition = (
  backgroundMusic: MinecraftBackgroundMusic | null,
  context: MinecraftMusicContext,
): MinecraftMusicDefinition | null => {
  if (backgroundMusic === null) {
    return null
  }
  return resolveMinecraftBackgroundMusicDefinition(backgroundMusic, context)
}

const resolveDesiredDefinition = (
  input: MinecraftMusicTickInput,
  biomeMusic: MinecraftMusicDefinition | null,
): MinecraftMusicDefinition | null => {
  const explicitDefinition = input.definition
  if (explicitDefinition === null) {
    return null
  }
  if (typeof explicitDefinition === 'object') {
    return explicitDefinition
  }
  if (!isMissing(input.backgroundMusic)) {
    return resolveBackgroundMusicDefinition(input.backgroundMusic, input.context)
  }
  if (!isMissing(input.biomeMusic)) {
    return biomeMusic
  }
  return resolveMinecraftMusicDefinition(input.context)
}

const activeStateFor = ({
  backend,
  handle,
}: { readonly backend: AudioBackend; readonly handle: ToneHandle | null }): Effect.Effect<boolean> => {
  if (handle === null) {
    return Effect.succeed(false)
  }
  return backend.isToneActive(handle)
}

type BiomeMusicSelectionOptions = {
  readonly currentActive: boolean
  readonly enabled: boolean
  readonly input: MinecraftMusicTickInput
  readonly randomSource: () => unknown
  readonly selectionRef: Ref.Ref<BiomeMusicSelection | null>
  readonly state: MinecraftMusicState
}

const selectBiomeMusicForTick = ({
  currentActive,
  enabled,
  input,
  randomSource,
  selectionRef,
  state,
}: BiomeMusicSelectionOptions): Effect.Effect<MinecraftMusicDefinition | null, MinecraftMusicPlaybackError> =>
  Effect.gen(function* selectBiomeMusicForTickEffect() {
    if (
      !enabled ||
      !isMissing(input.definition) ||
      !isMissing(input.backgroundMusic) ||
      isMissing(input.biomeMusic)
    ) {
      yield* Ref.set(selectionRef, null)
      return null
    }
    const previousSelection = yield* Ref.get(selectionRef)
    const canReuseSelection =
      previousSelection !== null &&
      previousSelection.source === input.biomeMusic &&
      (state.currentSound === null || currentActive)
    if (canReuseSelection) {
      return previousSelection.definition
    }
    const selected = yield* Effect.fromResult(
      selectMinecraftBiomeMusicDefinition(input.biomeMusic, randomSource()),
    ).pipe(Effect.mapError((cause) => playbackError(null, cause)))
    yield* Ref.set(selectionRef, { definition: selected, source: input.biomeMusic })
    return selected
  })

const clearBiomeSelectionWhenStopped = (
  selectionRef: Ref.Ref<BiomeMusicSelection | null>,
  enabled: boolean,
  desired: MinecraftMusicDefinition | null,
): Effect.Effect<void> => {
  if (!enabled || desired === null) {
    return Ref.set(selectionRef, null)
  }
  return Effect.void
}

const stopMusicAndClearBiomeSelection = (
  resources: MusicPlayerResources,
  selectionRef: Ref.Ref<BiomeMusicSelection | null>,
): Effect.Effect<void> =>
  Effect.gen(function* stopMusicAndClearBiomeSelectionEffect() {
    yield* stopCurrentMusic(resources)
    yield* Ref.set(selectionRef, null)
  })

export const makeMinecraftMusicPlayer = (
  registry: MinecraftSoundRegistry,
  randomSource: () => unknown,
): Effect.Effect<MinecraftMusicPlayer, never, AudioBackendPort> =>
  Effect.gen(function* buildMinecraftMusicPlayer() {
    const backend = yield* AudioBackendPort
    const stateRef = yield* Ref.make(initialMinecraftMusicState())
    const gainScaleRef = yield* Ref.make(DEFAULT_MUSIC_GAIN_SCALE)
    const handleRef = yield* Ref.make<ToneHandle | null>(null)
    const biomeSelectionRef = yield* Ref.make<BiomeMusicSelection | null>(null)
    const resources = { backend, gainScaleRef, handleRef, stateRef }
    const applyPlan = makeMusicCommandApplier({ ...resources, randomSource, registry })
    const prepareTick = (
      input: MinecraftMusicTickInput,
    ): Effect.Effect<{
      readonly desired: MinecraftMusicDefinition | null
      readonly enabled: boolean
      readonly plan: MinecraftMusicPlan
    }, MinecraftMusicPlaybackError> =>
      Effect.gen(function* prepareMinecraftMusicTick() {
        const state = yield* Ref.get(stateRef)
        const handle = yield* Ref.get(handleRef)
        const currentActive = yield* activeStateFor({ backend, handle })
        const enabled = input.enabled ?? DEFAULT_ENABLED
        const selectedBiomeMusic = yield* selectBiomeMusicForTick({
          currentActive,
          enabled,
          input,
          randomSource,
          selectionRef: biomeSelectionRef,
          state,
        })
        const desired = resolveDesiredDefinition(input, selectedBiomeMusic)
        const plan = yield* Effect.fromResult(planMinecraftMusic({
          currentActive,
          desired,
          enabled,
          musicVolume: input.musicVolume ?? DEFAULT_MUSIC_VOLUME,
          randomIntInclusive: (min, max) => randomIntInclusive(randomSource, min, max),
          state,
        })).pipe(Effect.mapError((cause: MinecraftMusicDataFailure) => playbackError(desired?.sound ?? null, cause)))
        return { desired, enabled, plan }
      })

    const tickReady = (
      input: MinecraftMusicTickInput,
    ): Effect.Effect<MinecraftMusicTickResult, MinecraftMusicPlaybackError> =>
      Effect.gen(function* tickReadyEffect() {
        const prepared = yield* prepareTick(input)
        const applied = yield* applyPlan(prepared.plan)
        const appliedPlan = { ...prepared.plan, state: applied.state }
        yield* clearBiomeSelectionWhenStopped(biomeSelectionRef, prepared.enabled, prepared.desired)
        return {
          plan: appliedPlan,
          played: applied.played,
          soundId: applied.state.currentSound,
        }
      })

    return {
      stop: stopMusicAndClearBiomeSelection(resources, biomeSelectionRef),
      tick: (input: MinecraftMusicTickInput) =>
        Effect.gen(function* tickMinecraftMusic() {
          const availability = yield* backend.availability
          if (availability !== 'ready') {
            yield* stopMusicAndClearBiomeSelection(resources, biomeSelectionRef)
            return {
              plan: { commands: [], state: initialMinecraftMusicState() },
              played: false,
              soundId: null,
            }
          }
          return yield* tickReady(input)
        }),
    }
  })

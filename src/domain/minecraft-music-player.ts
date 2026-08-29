import {
  type AudioBackend,
  AudioBackendPort,
  type ToneHandle,
  type TonePlayback,
} from './backend-port.js'
import { Effect, Ref } from 'effect'
import {
  type MinecraftBackgroundMusic,
  type MinecraftBiomeMusic,
  type MinecraftMusicContext,
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
import { clampNonNegative } from './volume.js'

const DEFAULT_MUSIC_VOLUME = 1
const RANDOM_UPPER_BOUND = DEFAULT_MUSIC_VOLUME - Number.EPSILON
const RANDOM_LOWER_BOUND = 0
const RANDOM_INTERVAL_STEP = Math.ceil(RANDOM_UPPER_BOUND - RANDOM_LOWER_BOUND)
const DEFAULT_ENABLED = true
const DEFAULT_MUSIC_GAIN_SCALE = 1

const isMissing = (value: unknown): value is undefined => Object.is(value, globalThis.undefined)

export type MinecraftMusicTickInput = {
  readonly context: MinecraftMusicContext
  readonly enabled?: boolean
  readonly musicVolume?: number
  readonly backgroundMusic?: MinecraftBackgroundMusic | null
  readonly biomeMusic?: MinecraftBiomeMusic
  readonly definition?: MinecraftMusicDefinition | null
}

export type MinecraftMusicTickResult = {
  readonly plan: MinecraftMusicPlan
  readonly played: boolean
  readonly soundId: string | null
}

export type MinecraftMusicPlaybackError = {
  readonly _tag: 'MinecraftMusicPlaybackError'
  readonly cause: unknown
  readonly soundId: string
}

export type MinecraftMusicPlayer = {
  readonly tick: (
    input: MinecraftMusicTickInput,
  ) => Effect.Effect<MinecraftMusicTickResult, MinecraftMusicPlaybackError>
  readonly stop: Effect.Effect<void>
}

const randomIntInclusive = (
  randomSource: () => number,
  min: number,
  max: number,
): number => {
  const sample = randomSource()
  let normalized = RANDOM_LOWER_BOUND
  if (Number.isFinite(sample)) {
    normalized = Math.min(RANDOM_UPPER_BOUND, Math.max(RANDOM_LOWER_BOUND, sample))
  }
  return Math.floor(min + normalized * (max - min + RANDOM_INTERVAL_STEP))
}

const playbackError = (soundId: string, cause: unknown): MinecraftMusicPlaybackError => ({
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
  readonly randomSource: () => number
  readonly registry: MinecraftSoundRegistry
}

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
  const applyGainCommand = (gain: number): Effect.Effect<void> =>
    Effect.gen(function* applyGainCommandEffect() {
      const handle = yield* Ref.get(handleRef)
      if (handle !== null) {
        const scale = yield* Ref.get(gainScaleRef)
        yield* backend.setToneGain(handle, clampNonNegative(gain * scale))
      }
    })

  const resolveStartCommand = (
    definition: StartMusicCommand,
  ): Effect.Effect<ReturnType<typeof resolveMinecraftSound>, MinecraftMusicPlaybackError> =>
    Effect.try({
      catch: (cause) => playbackError(definition.definition.sound, cause),
      try: () => resolveMinecraftSound(registry, definition.definition.sound, randomSource()),
    })

  const applyStartCommand = (
    definition: StartMusicCommand,
    resolved: ReturnType<typeof resolveMinecraftSound>,
  ): Effect.Effect<boolean, MinecraftMusicPlaybackError> =>
    Effect.gen(function* applyStartCommandEffect() {
      const resolvedVolume = clampNonNegative(resolved.volume)
      const playbackEffect = yield* Effect.try({
        catch: (cause): MinecraftMusicPlaybackError => playbackError(resolved.soundId, cause),
        try: () =>
          backend.playMusic({
            gain: clampNonNegative(definition.gain * resolvedVolume),
            playbackRate: resolved.pitch,
            soundId: resolved.soundId,
            stream: resolved.stream,
          }),
      })
      const playback: TonePlayback = yield* playbackEffect
      if (!playback.accepted) {
        yield* clearMusicPlaybackState({ gainScaleRef, handleRef })
        return false
      }
      const handle: ToneHandle = { id: playback.id }
      yield* Ref.set(handleRef, handle)
      yield* Ref.set(gainScaleRef, resolvedVolume)
      return true
    })

  const resolveStartCommands = (
    plan: MinecraftMusicPlan,
  ): Effect.Effect<Map<StartMusicCommand, ReturnType<typeof resolveMinecraftSound>>, MinecraftMusicPlaybackError> =>
    Effect.gen(function* resolveMinecraftStartCommands() {
      const resolvedStarts = new Map<
        StartMusicCommand,
        ReturnType<typeof resolveMinecraftSound>
      >()
      for (const command of plan.commands) {
        if (command.kind === 'start') {
          resolvedStarts.set(command, yield* resolveStartCommand(command))
        }
      }
      return resolvedStarts
    })

  const applyMusicCommand = (
    command: MinecraftMusicPlan['commands'][number],
    resolvedStarts: Map<StartMusicCommand, ReturnType<typeof resolveMinecraftSound>>,
  ): Effect.Effect<boolean, MinecraftMusicPlaybackError> => {
    if (command.kind === 'stop') {
      return stopActiveHandle({ backend, gainScaleRef, handleRef }).pipe(Effect.as(false))
    }
    if (command.kind === 'gain') {
      return applyGainCommand(command.gain).pipe(Effect.as(false))
    }
    return applyStartCommand(command, resolvedStarts.get(command)!)
  }

  const applyMusicCommands = (
    plan: MinecraftMusicPlan,
    resolvedStarts: Map<StartMusicCommand, ReturnType<typeof resolveMinecraftSound>>,
  ): Effect.Effect<boolean, MinecraftMusicPlaybackError> =>
    Effect.gen(function* applyMinecraftMusicCommands() {
      let played = false
      for (const command of plan.commands) {
        const commandPlayed = yield* applyMusicCommand(command, resolvedStarts)
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
      const resolvedStarts = yield* resolveStartCommands(plan)
      const played = yield* applyMusicCommands(plan, resolvedStarts)
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
  readonly randomSource: () => number
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
}: BiomeMusicSelectionOptions): Effect.Effect<MinecraftMusicDefinition | null> =>
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
    const selected = selectMinecraftBiomeMusicDefinition(input.biomeMusic, randomSource())
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
  randomSource: () => number,
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
    }> =>
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
        const plan = planMinecraftMusic({
          currentActive,
          desired,
          enabled,
          musicVolume: input.musicVolume ?? DEFAULT_MUSIC_VOLUME,
          randomIntInclusive: (min, max) => randomIntInclusive(randomSource, min, max),
          state,
        })
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

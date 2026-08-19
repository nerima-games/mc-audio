import { type AudioBackend, AudioBackendPort, type ToneHandle } from './backend-port.js'
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

export type MinecraftMusicPlayer = {
  readonly tick: (input: MinecraftMusicTickInput) => Effect.Effect<MinecraftMusicTickResult>
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

const hasStartCommand = (plan: MinecraftMusicPlan): boolean => plan.commands.some((command) => command.kind === 'start')

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
}: MusicCommandApplierOptions): ((plan: MinecraftMusicPlan) => Effect.Effect<void>) => {
  const applyGainCommand = (gain: number): Effect.Effect<void> =>
    Effect.gen(function* applyGainCommandEffect() {
      const handle = yield* Ref.get(handleRef)
      if (handle !== null) {
        const scale = yield* Ref.get(gainScaleRef)
        yield* backend.setToneGain(handle, clampNonNegative(gain * scale))
      }
    })

  const applyStartCommand = (definition: StartMusicCommand): Effect.Effect<void> =>
    Effect.gen(function* applyStartCommandEffect() {
      const resolved = resolveMinecraftSound(registry, definition.definition.sound, randomSource())
      const resolvedVolume = clampNonNegative(resolved.volume)
      const handle = yield* backend.playMusic({
        gain: clampNonNegative(definition.gain * resolvedVolume),
        playbackRate: resolved.pitch,
        soundId: resolved.soundId,
        stream: resolved.stream,
      })
      yield* Ref.set(handleRef, handle)
      yield* Ref.set(gainScaleRef, resolvedVolume)
    })

  const applyCommand = (command: MinecraftMusicPlan['commands'][number]): Effect.Effect<void> => {
    if (command.kind === 'stop') {
      return stopActiveHandle({ backend, gainScaleRef, handleRef })
    }
    if (command.kind === 'gain') {
      return applyGainCommand(command.gain)
    }
    return applyStartCommand(command)
  }

  return (plan) =>
    Effect.gen(function* applyMusicPlan() {
      for (const command of plan.commands) {
        yield* applyCommand(command)
      }
      yield* Ref.set(stateRef, plan.state)
      if (plan.state.currentSound === null) {
        yield* Ref.set(handleRef, null)
        yield* Ref.set(gainScaleRef, DEFAULT_MUSIC_GAIN_SCALE)
      }
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
    const stopCurrent = Effect.gen(function* stopCurrentMusicAndSelection() {
      yield* stopCurrentMusic(resources)
      yield* Ref.set(biomeSelectionRef, null)
    })

    const tickReady = (input: MinecraftMusicTickInput): Effect.Effect<MinecraftMusicTickResult> =>
      Effect.gen(function* tickReadyEffect() {
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
        yield* applyPlan(plan)
        yield* clearBiomeSelectionWhenStopped(biomeSelectionRef, enabled, desired)
        return {
          plan,
          played: hasStartCommand(plan),
          soundId: plan.state.currentSound,
        }
      })

    return {
      stop: stopCurrent,
      tick: (input: MinecraftMusicTickInput) =>
        Effect.gen(function* tickMinecraftMusic() {
          const availability = yield* backend.availability
          if (availability !== 'ready') {
            yield* stopCurrent
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

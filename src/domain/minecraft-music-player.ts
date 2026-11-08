import {
  type AudioBackend,
  AudioBackendPort,
  type MusicRequest,
  type ToneHandle,
  type TonePlayback,
} from './backend-port.js'
import {
  type AudioDurationSecs,
  type AudioGain,
  type AudioVolume,
  type MinecraftSoundEventId,
  type MinecraftSoundResourceId,
  AudioDurationSecs as makeAudioDurationSecs,
  AudioGain as makeAudioGain,
  AudioVolume as makeAudioVolume,
} from './audio-brands.js'
import { Effect, Ref, Result } from 'effect'
import {
  type MinecraftBackgroundMusic,
  type MinecraftBiomeMusic,
  type MinecraftMusicContext,
  type MinecraftMusicDataFailure,
  type MinecraftMusicDefinition,
  type MinecraftMusicPlan,
  type MinecraftMusicScene,
  type MinecraftMusicScenePlaylist,
  type MinecraftMusicScenePlaylistManifest,
  type MinecraftMusicState,
  initialMinecraftMusicState,
  minecraftMusicDefinitionForSceneTrack,
  planMinecraftMusic,
  resolveMinecraftBackgroundMusicDefinition,
  resolveMinecraftMusicDefinition,
  selectMinecraftBiomeMusicDefinition,
  selectMinecraftMusicSceneTrack,
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
const GAME_TICKS_PER_SECOND = 20
const NEXT_COMMAND_INDEX_OFFSET = 1
const ZERO_TICKS = 0
const NO_CROSSFADE_SECS = makeAudioDurationSecs(ZERO_TICKS)

const isMissing = (value: unknown): value is undefined => Object.is(value, globalThis.undefined)

export type MinecraftMusicTickInput = {
  readonly context: MinecraftMusicContext
  readonly enabled?: boolean
  readonly musicVolume?: AudioVolume
  readonly backgroundMusic?: MinecraftBackgroundMusic | null
  readonly biomeMusic?: MinecraftBiomeMusic
  readonly definition?: MinecraftMusicDefinition | null
  readonly scene?: MinecraftMusicScene
  readonly scenePlaylists?: MinecraftMusicScenePlaylistManifest
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
): unknown => {
  const sample = randomSource()
  if (typeof sample !== 'number' || !Number.isFinite(sample)) {
    return sample
  }
  const normalized = Math.min(RANDOM_UPPER_BOUND, Math.max(RANDOM_LOWER_BOUND, sample))
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

type SceneMusicSelection = {
  readonly crossfadeSecs: AudioDurationSecs
  readonly definition: MinecraftMusicDefinition | null
  readonly fallbackDefinition: MinecraftMusicDefinition | null
}

type SceneMusicSelectionCache = {
  readonly scene: MinecraftMusicScene
  readonly track: MinecraftMusicScenePlaylist['tracks'][number]
}

type SceneMusicSelectionOptions = {
  readonly currentActive: boolean
  readonly input: MinecraftMusicTickInput
  readonly randomSource: () => unknown
  readonly selectionRef: Ref.Ref<SceneMusicSelectionCache | null>
  readonly state: MinecraftMusicState
}

type SceneTrackSelectionOptions = Omit<SceneMusicSelectionOptions, 'input'> & {
  readonly manifest: MinecraftMusicScenePlaylistManifest
  readonly playlist: MinecraftMusicScenePlaylist
  readonly scene: MinecraftMusicScene
}

type CachedSceneTrackOptions = {
  readonly currentActive: boolean
  readonly previousSelection: SceneMusicSelectionCache | null
  readonly playlist: MinecraftMusicScenePlaylist
  readonly scene: MinecraftMusicScene
  readonly state: MinecraftMusicState
}

type MusicCommandApplierOptions = MusicPlayerResources & {
  readonly randomSource: () => unknown
  readonly registry: MinecraftSoundRegistry
}

type StartMusicCommandWithResolution = StartMusicCommand & {
  readonly fallbackResolved: ResolvedMinecraftSound | null
  readonly resolved: ResolvedMinecraftSound
}

type ResolvedMusicCommand = Exclude<MinecraftMusicPlan['commands'][number], StartMusicCommand> | StartMusicCommandWithResolution

type StartMusicCommand = Extract<MinecraftMusicPlan['commands'][number], { readonly kind: 'start' }>

type AppliedMusicPlan = {
  readonly played: boolean
  readonly state: MinecraftMusicState
}

type StartMusicPlaybackOptions = {
  readonly definition: StartMusicCommand
  readonly fadeInSecs: AudioDurationSecs | null
  readonly fallbackResolved: ResolvedMinecraftSound | null
  readonly resolved: ResolvedMinecraftSound
}

type StartMusicCommandOptions = StartMusicCommandWithResolution & {
  readonly crossfadeSecs: AudioDurationSecs
}

type MusicPlayerRefs = {
  readonly biomeSelectionRef: Ref.Ref<BiomeMusicSelection | null>
  readonly gainScaleRef: Ref.Ref<number>
  readonly handleRef: Ref.Ref<ToneHandle | null>
  readonly sceneSelectionRef: Ref.Ref<SceneMusicSelectionCache | null>
  readonly stateRef: Ref.Ref<MinecraftMusicState>
}

type FallbackSoundOptions = {
  readonly command: StartMusicCommand
  readonly fallbackDefinition: MinecraftMusicDefinition | null
  readonly randomSource: () => unknown
  readonly registry: MinecraftSoundRegistry
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

const resolveFallbackSound = ({
  command,
  fallbackDefinition,
  randomSource,
  registry,
}: FallbackSoundOptions): ResolvedMinecraftSound | null => {
  if (fallbackDefinition === null || fallbackDefinition.sound === command.definition.sound) {
    return null
  }
  const resolved = resolveMinecraftSound(registry, fallbackDefinition.sound, randomSource())
  if (Result.isFailure(resolved)) {
    return null
  }
  return resolved.success
}

const makeMusicPlayerRefs = (): Effect.Effect<MusicPlayerRefs> => Effect.gen(function* makeMusicPlayerRefsEffect() {
  return {
    biomeSelectionRef: yield* Ref.make<BiomeMusicSelection | null>(null),
    gainScaleRef: yield* Ref.make(DEFAULT_MUSIC_GAIN_SCALE),
    handleRef: yield* Ref.make<ToneHandle | null>(null),
    sceneSelectionRef: yield* Ref.make<SceneMusicSelectionCache | null>(null),
    stateRef: yield* Ref.make(initialMinecraftMusicState()),
  }
})

const skipPairedCrossfadeStop = (
  command: ResolvedMusicCommand,
  next: ResolvedMusicCommand | undefined,
  crossfadeSecs: AudioDurationSecs,
): boolean => command.kind === 'stop' && next?.kind === 'start' && crossfadeSecs > NO_CROSSFADE_SECS

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

const rejectMusicStart = ({
  backend,
  gainScaleRef,
  handleRef,
  previousActive,
  previousHandle,
}: Pick<MusicPlayerResources, 'backend' | 'gainScaleRef' | 'handleRef'> & {
  readonly previousActive: boolean
  readonly previousHandle: ToneHandle | null
}): Effect.Effect<void> => Effect.gen(function* rejectMusicStartEffect() {
  if (previousHandle !== null && previousActive) {
    yield* backend.stopTone(previousHandle)
  }
  yield* clearMusicPlaybackState({ gainScaleRef, handleRef })
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
  fallbackDefinition: MinecraftMusicDefinition | null,
  crossfadeSecs: AudioDurationSecs,
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
    fallbackDefinition: MinecraftMusicDefinition | null,
  ): Effect.Effect<ReadonlyArray<ResolvedMusicCommand>, MinecraftMusicPlaybackError> =>
    Effect.gen(function* resolveMinecraftStartCommands() {
      const resolvedCommands: ResolvedMusicCommand[] = []
      for (const command of plan.commands) {
        if (command.kind === 'start') {
          const resolved = yield* resolveStartCommand(command)
          resolvedCommands.push({
            ...command,
            fallbackResolved: resolveFallbackSound({ command, fallbackDefinition, randomSource, registry }),
            resolved,
          })
        } else {
          resolvedCommands.push(command)
        }
      }
      return resolvedCommands
    })

  const createStartMusicPlayback = ({
    definition,
    fadeInSecs,
    fallbackResolved,
    resolved,
  }: StartMusicPlaybackOptions): Effect.Effect<{ readonly playback: TonePlayback; readonly resolvedVolume: AudioGain }, MinecraftMusicPlaybackError> =>
    Effect.gen(function* createStartMusicPlaybackEffect() {
      const playResolvedMusic = (sound: ResolvedMinecraftSound): Effect.Effect<TonePlayback, MinecraftMusicPlaybackError> => {
        const gain = makeAudioGain(definition.gain * clampNonNegative(sound.volume))
        const request: MusicRequest = {
          gain,
          playbackRate: sound.pitch,
          soundId: sound.soundId,
          stream: sound.stream,
        }
        return Effect.gen(function* playResolvedMusicEffect() {
          const playbackEffect = yield* Effect.try({
            catch: (cause): MinecraftMusicPlaybackError => playbackError(sound.soundId, cause),
            try: () => {
              if (fadeInSecs === null) {
                return backend.playMusic(request)
              }
              return backend.playMusic({ ...request, fadeInSecs })
            },
          })
          return yield* playbackEffect
        })
      }
      const primaryVolume = clampNonNegative(resolved.volume)
      const primaryPlayback = yield* playResolvedMusic(resolved)
      if (primaryPlayback.accepted || fallbackResolved === null) {
        return { playback: primaryPlayback, resolvedVolume: primaryVolume }
      }
      const fallbackPlayback = yield* playResolvedMusic(fallbackResolved)
      return {
        playback: fallbackPlayback,
        resolvedVolume: clampNonNegative(fallbackResolved.volume),
      }
    })

  const stopPreviousMusic = ({
    crossfadeSecs,
    previousActive,
    previousHandle,
  }: {
    readonly crossfadeSecs: AudioDurationSecs
    readonly previousActive: boolean
    readonly previousHandle: ToneHandle | null
  }): Effect.Effect<void> => {
    if (previousHandle === null || !previousActive) {
      return Effect.void
    }
    return backend.stopTone(previousHandle, crossfadeSecs)
  }

  const completeMusicStart = ({
    playback,
    previousActive,
    previousHandle,
    resolvedVolume,
    crossfadeSecs,
  }: {
    readonly crossfadeSecs: AudioDurationSecs
    readonly playback: TonePlayback
    readonly previousActive: boolean
    readonly previousHandle: ToneHandle | null
    readonly resolvedVolume: AudioGain
  }): Effect.Effect<boolean> =>
    Effect.gen(function* completeMusicStartEffect() {
      yield* stopPreviousMusic({ crossfadeSecs, previousActive, previousHandle })
      yield* Ref.set(handleRef, { id: playback.id })
      yield* Ref.set(gainScaleRef, resolvedVolume)
      return true
    })

  const applyStartCommand = ({
    crossfadeSecs,
    definition,
    fallbackResolved,
    gain,
    resolved,
  }: StartMusicCommandOptions): Effect.Effect<boolean, MinecraftMusicPlaybackError> =>
    Effect.gen(function* applyStartCommandEffect() {
      const previousHandle = yield* Ref.get(handleRef)
      const previousActive = yield* activeStateFor({ backend, handle: previousHandle })
      let fadeInSecs: AudioDurationSecs | null = null
      if (previousActive) {
        fadeInSecs = crossfadeSecs
      }
      const { playback, resolvedVolume } = yield* createStartMusicPlayback({
        definition: { definition, gain, kind: 'start' },
        fadeInSecs,
        fallbackResolved,
        resolved,
      })
      if (!playback.accepted) {
        yield* rejectMusicStart({ backend, gainScaleRef, handleRef, previousActive, previousHandle })
        return false
      }
      return yield* completeMusicStart({
        crossfadeSecs,
        playback,
        previousActive,
        previousHandle,
        resolvedVolume,
      })
    })

  const applyMusicCommand = (
    command: ResolvedMusicCommand,
    crossfadeSecs: AudioDurationSecs,
  ): Effect.Effect<boolean, MinecraftMusicPlaybackError> => {
    if (command.kind === 'stop') {
      return stopActiveHandle({ backend, gainScaleRef, handleRef }).pipe(Effect.as(false))
    }
    if (command.kind === 'gain') {
      return applyGainCommand(command.gain).pipe(Effect.as(false))
    }
    return applyStartCommand({ ...command, crossfadeSecs })
  }

  const applyMusicCommands = (
    plan: ReadonlyArray<ResolvedMusicCommand>,
    crossfadeSecs: AudioDurationSecs,
  ): Effect.Effect<boolean, MinecraftMusicPlaybackError> =>
    Effect.gen(function* applyMinecraftMusicCommands() {
      for (const [index, command] of plan.entries()) {
        const next = plan[index + NEXT_COMMAND_INDEX_OFFSET]
        if (!skipPairedCrossfadeStop(command, next, crossfadeSecs)) {
          const commandPlayed = yield* applyMusicCommand(command, crossfadeSecs)
          if (command.kind === 'start' && !commandPlayed) {
            yield* Ref.set(stateRef, initialMinecraftMusicState())
            return false
          }
          if (command.kind === 'start') {
            return true
          }
        }
      }
      return false
    })

  return (plan, fallbackDefinition, crossfadeSecs) =>
    Effect.gen(function* applyMusicPlan() {
      const resolvedCommands = yield* resolveStartCommands(plan, fallbackDefinition)
      const played = yield* applyMusicCommands(resolvedCommands, crossfadeSecs)
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
      !isMissing(input.scene) ||
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

const sceneMusicSelectionFor = (
  input: MinecraftMusicTickInput,
  playlist: MinecraftMusicScenePlaylist,
  track: SceneMusicSelectionCache['track'] | null,
): SceneMusicSelection => {
  let definition: MinecraftMusicDefinition | null = null
  let fallbackDefinition: MinecraftMusicDefinition | null = null
  if (track !== null) {
    definition = minecraftMusicDefinitionForSceneTrack(playlist, track)
    fallbackDefinition = resolveMinecraftMusicDefinition(input.context)
  }
  return {
    crossfadeSecs: makeAudioDurationSecs(Number(playlist.crossfadeTicks) / GAME_TICKS_PER_SECOND),
    definition,
    fallbackDefinition,
  }
}

const cachedSceneTrack = ({
  currentActive,
  previousSelection,
  playlist,
  scene,
  state,
}: CachedSceneTrackOptions): SceneMusicSelectionCache['track'] | null => {
  if (previousSelection === null || previousSelection.scene !== scene) {
    return null
  }
  const currentTrackIsCached = currentActive && state.currentSound === previousSelection.track.eventId
  const cachedTrackIsInPlaylist = playlist.tracks.some((track) =>
    track.eventId === previousSelection.track.eventId && track.file === previousSelection.track.file,
  )
  const selectedTrackIsInSilenceGap =
    cachedTrackIsInPlaylist && state.currentSound === null && state.nextSongDelayTicks > ZERO_TICKS
  if (currentTrackIsCached || selectedTrackIsInSilenceGap) {
    return previousSelection.track
  }
  return null
}

const emptySceneMusicSelection: SceneMusicSelection = {
  crossfadeSecs: NO_CROSSFADE_SECS,
  definition: null,
  fallbackDefinition: null,
}

const clearSceneSelectionAndReturnEmpty = (
  selectionRef: Ref.Ref<SceneMusicSelectionCache | null>,
): Effect.Effect<SceneMusicSelection> => Effect.gen(function* clearSceneSelectionAndReturnEmptyEffect() {
  yield* Ref.set(selectionRef, null)
  return emptySceneMusicSelection
})

const selectSceneTrackForTick = ({
  currentActive,
  manifest,
  playlist,
  randomSource,
  scene,
  selectionRef,
  state,
}: SceneTrackSelectionOptions): Effect.Effect<SceneMusicSelectionCache['track'] | null, MinecraftMusicPlaybackError> =>
  Effect.gen(function* selectSceneTrackForTickEffect() {
    const previousSelection = yield* Ref.get(selectionRef)
    const cachedTrack = cachedSceneTrack({ currentActive, playlist, previousSelection, scene, state })
    if (cachedTrack !== null) {
      return cachedTrack
    }
    const track = yield* Effect.fromResult(selectMinecraftMusicSceneTrack({
      manifest,
      random: randomSource(),
      scene,
    })).pipe(Effect.mapError((cause) => playbackError(null, cause)))
    if (track === null) {
      yield* Ref.set(selectionRef, null)
      return null
    }
    yield* Ref.set(selectionRef, { scene, track })
    return track
  })

type ScenePlaylistSelectionOptions = Omit<SceneMusicSelectionOptions, 'input'> & {
  readonly input: MinecraftMusicTickInput
  readonly manifest: MinecraftMusicScenePlaylistManifest
  readonly scene: MinecraftMusicScene
}

const selectScenePlaylistForTick = ({
  currentActive,
  input,
  manifest,
  randomSource,
  scene,
  selectionRef,
  state,
}: ScenePlaylistSelectionOptions): Effect.Effect<SceneMusicSelection, MinecraftMusicPlaybackError> =>
  Effect.gen(function* selectScenePlaylistForTickEffect() {
    const playlist = manifest[scene]
    if (isMissing(playlist)) {
      return yield* clearSceneSelectionAndReturnEmpty(selectionRef)
    }
    const track = yield* selectSceneTrackForTick({
      currentActive,
      manifest,
      playlist,
      randomSource,
      scene,
      selectionRef,
      state,
    })
    return sceneMusicSelectionFor(input, playlist, track)
  })

const selectSceneMusicForTick = ({
  currentActive,
  input,
  randomSource,
  selectionRef,
  state,
}: SceneMusicSelectionOptions): Effect.Effect<SceneMusicSelection | null, MinecraftMusicPlaybackError> =>
  Effect.gen(function* selectSceneMusicForTickEffect() {
    const { scene, scenePlaylists } = input
    if (isMissing(scene)) {
      yield* Ref.set(selectionRef, null)
      return null
    }
    if (isMissing(scenePlaylists)) {
      return yield* clearSceneSelectionAndReturnEmpty(selectionRef)
    }
    return yield* selectScenePlaylistForTick({
      currentActive,
      input,
      manifest: scenePlaylists,
      randomSource,
      scene,
      selectionRef,
      state,
    })
  })

type SelectedMusicForTick = {
  readonly desired: MinecraftMusicDefinition | null
  readonly sceneSelection: SceneMusicSelection | null
}

type SelectMusicForTickOptions = {
  readonly currentActive: boolean
  readonly enabled: boolean
  readonly input: MinecraftMusicTickInput
  readonly randomSource: () => unknown
  readonly sceneSelectionRef: Ref.Ref<SceneMusicSelectionCache | null>
  readonly selectionRef: Ref.Ref<BiomeMusicSelection | null>
  readonly state: MinecraftMusicState
}

const selectMusicForTick = ({
  currentActive,
  enabled,
  input,
  randomSource,
  sceneSelectionRef,
  selectionRef,
  state,
}: SelectMusicForTickOptions): Effect.Effect<SelectedMusicForTick, MinecraftMusicPlaybackError> =>
  Effect.gen(function* selectMusicForTickEffect() {
    if (!enabled) {
      yield* Ref.set(sceneSelectionRef, null)
      yield* Ref.set(selectionRef, null)
      return { desired: resolveDesiredDefinition(input, null), sceneSelection: null }
    }
    const sceneSelection = yield* selectSceneMusicForTick({
      currentActive,
      input,
      randomSource,
      selectionRef: sceneSelectionRef,
      state,
    })
    if (sceneSelection !== null) {
      yield* Ref.set(selectionRef, null)
      return { desired: sceneSelection.definition, sceneSelection }
    }
    const biomeMusic = yield* selectBiomeMusicForTick({
      currentActive,
      enabled,
      input,
      randomSource,
      selectionRef,
      state,
    })
    return {
      desired: resolveDesiredDefinition(input, biomeMusic),
      sceneSelection: null,
    }
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

const clearSceneSelectionWhenStopped = (
  selectionRef: Ref.Ref<SceneMusicSelectionCache | null>,
  enabled: boolean,
  desired: MinecraftMusicDefinition | null,
): Effect.Effect<void> => {
  if (!enabled || desired === null) {
    return Ref.set(selectionRef, null)
  }
  return Effect.void
}

const stopMusicAndClearSelections = (
  resources: MusicPlayerResources,
  biomeSelectionRef: Ref.Ref<BiomeMusicSelection | null>,
  sceneSelectionRef: Ref.Ref<SceneMusicSelectionCache | null>,
): Effect.Effect<void> =>
  Effect.gen(function* stopMusicAndClearSelectionsEffect() {
    yield* stopCurrentMusic(resources)
    yield* Ref.set(biomeSelectionRef, null)
    yield* Ref.set(sceneSelectionRef, null)
  })

export const makeMinecraftMusicPlayer = (
  registry: MinecraftSoundRegistry,
  randomSource: () => unknown,
): Effect.Effect<MinecraftMusicPlayer, never, AudioBackendPort> =>
  Effect.gen(function* buildMinecraftMusicPlayer() {
    const backend = yield* AudioBackendPort
    const { stateRef, gainScaleRef, handleRef, biomeSelectionRef, sceneSelectionRef } = yield* makeMusicPlayerRefs()
    const resources = { backend, gainScaleRef, handleRef, stateRef }
    const applyPlan = makeMusicCommandApplier({ ...resources, randomSource, registry })
    const prepareTick = (
      input: MinecraftMusicTickInput,
    ): Effect.Effect<{
      readonly crossfadeSecs: AudioDurationSecs
      readonly desired: MinecraftMusicDefinition | null
      readonly enabled: boolean
      readonly fallbackDefinition: MinecraftMusicDefinition | null
      readonly plan: MinecraftMusicPlan
    }, MinecraftMusicPlaybackError> =>
      Effect.gen(function* prepareMinecraftMusicTick() {
        const { enabled = DEFAULT_ENABLED, musicVolume = DEFAULT_MUSIC_VOLUME } = input
        const state = yield* Ref.get(stateRef)
        const handle = yield* Ref.get(handleRef)
        const currentActive = yield* activeStateFor({ backend, handle })
        const selected = yield* selectMusicForTick({
          currentActive,
          enabled,
          input,
          randomSource,
          sceneSelectionRef,
          selectionRef: biomeSelectionRef,
          state,
        })
        const plan = yield* Effect.fromResult(planMinecraftMusic({
          currentActive,
          desired: selected.desired,
          enabled,
          musicVolume,
          randomIntInclusive: (min, max) => randomIntInclusive(randomSource, min, max),
          state,
        })).pipe(Effect.mapError((cause: MinecraftMusicDataFailure) => playbackError(selected.desired?.sound ?? null, cause)))
        return {
          crossfadeSecs: selected.sceneSelection?.crossfadeSecs ?? NO_CROSSFADE_SECS,
          desired: selected.desired,
          enabled,
          fallbackDefinition: selected.sceneSelection?.fallbackDefinition ?? null,
          plan,
        }
      })

    const tickReady = (
      input: MinecraftMusicTickInput,
    ): Effect.Effect<MinecraftMusicTickResult, MinecraftMusicPlaybackError> =>
      Effect.gen(function* tickReadyEffect() {
        const prepared = yield* prepareTick(input)
        const applied = yield* applyPlan(prepared.plan, prepared.fallbackDefinition, prepared.crossfadeSecs)
        const appliedPlan = { ...prepared.plan, state: applied.state }
        yield* clearBiomeSelectionWhenStopped(biomeSelectionRef, prepared.enabled, prepared.desired)
        yield* clearSceneSelectionWhenStopped(sceneSelectionRef, prepared.enabled, prepared.desired)
        return {
          plan: appliedPlan,
          played: applied.played,
          soundId: applied.state.currentSound,
        }
      })

    return {
      stop: stopMusicAndClearSelections(resources, biomeSelectionRef, sceneSelectionRef),
      tick: (input: MinecraftMusicTickInput) =>
        Effect.gen(function* tickMinecraftMusic() {
          const availability = yield* backend.availability
          if (availability !== 'ready') {
            yield* stopMusicAndClearSelections(resources, biomeSelectionRef, sceneSelectionRef)
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

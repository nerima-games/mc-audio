import {
  type AudioAvailability,
  AudioBackendPort,
  type ToneHandle,
  type TonePlayback,
  type ToneRequest,
} from './backend-port.js'
import {
  type AudioDurationSecs,
  type AudioFrequencyHz,
  type AudioGain,
  type AudioPan,
  type AudioVolume,
  type MinecraftSoundEventId,
  AudioDurationSecs as makeAudioDurationSecs,
  AudioFrequencyHz as makeAudioFrequencyHz,
  AudioVolume as makeAudioVolume,
} from './audio-brands.js'
import { type CaptionEvent, type CaptionReason, CaptionStream } from './caption.js'
import { Effect, Result } from 'effect'
import {
  type MinecraftSoundRegistry,
  type MinecraftSoundResolutionFailure,
  type ResolvedMinecraftSound,
  resolveMinecraftSound,
} from './minecraft-sounds.js'
import {
  NO_SPATIALISATION,
  type Spatialisation,
  effectiveSfxGain,
  minecraftSpatialise,
} from './volume.js'
import type { CameraPoseSnapshot } from '@nerima-games/mc-kernel/domain/camera'
import { ClockPort } from '@nerima-games/mc-kernel/domain/clock'
import type { Position } from '@nerima-games/mc-kernel/domain/coordinates'

const DEFAULT_FREQUENCY_HZ = 440
const DEFAULT_FREQUENCY = makeAudioFrequencyHz(DEFAULT_FREQUENCY_HZ)
const DEFAULT_DURATION_VALUE_SECS = 0.12
const DEFAULT_DURATION_SECS = makeAudioDurationSecs(DEFAULT_DURATION_VALUE_SECS)
const DEFAULT_SFX_VOLUME_VALUE = 1
const DEFAULT_SFX_VOLUME = makeAudioVolume(DEFAULT_SFX_VOLUME_VALUE)
const DEFAULT_RANDOM = 0
const MIN_POSITIVE_VALUE = 0

export type MinecraftSoundPlayOptions = {
  readonly random?: number
  readonly position?: Position
  readonly listener?: Position
  readonly camera?: CameraPoseSnapshot
  readonly listenerForward?: Position
  readonly enabled?: boolean
  readonly gainScale?: AudioGain
  readonly sfxVolume?: AudioVolume
  readonly frequency?: AudioFrequencyHz
  readonly durationSecs?: AudioDurationSecs
  readonly loop?: boolean
}

export type MinecraftSoundPlaybackPlan = {
  readonly eventId: MinecraftSoundEventId
  readonly subtitle: string | null
  readonly sound: ResolvedMinecraftSound
  readonly request: ToneRequest
}

export type MinecraftSoundPlayback = MinecraftSoundPlaybackPlan & {
  readonly handle: ToneHandle | null
  readonly played: boolean
}

export type MinecraftSoundPlaybackError = {
  readonly _tag: 'MinecraftSoundPlaybackError'
  readonly eventId: MinecraftSoundEventId
  readonly cause: unknown
}

export type MinecraftSoundPlayer = {
  readonly play: (
    eventId: MinecraftSoundEventId,
    options?: MinecraftSoundPlayOptions,
  ) => Effect.Effect<MinecraftSoundPlayback, MinecraftSoundPlaybackError>
  readonly stop: (playback: MinecraftSoundPlayback) => Effect.Effect<void>
}

const isMissing = (value: unknown): value is undefined => Object.is(value, globalThis.undefined)

export type MinecraftSoundPlayOptionsFailure = {
  readonly _tag: 'MinecraftSoundPlayOptionsFailure'
  readonly field: 'durationSecs' | 'frequency'
  readonly message: string
}

const positiveFrequency = (value: unknown): Result.Result<AudioFrequencyHz, MinecraftSoundPlayOptionsFailure> => {
  if (isMissing(value)) {
    return Result.succeed(DEFAULT_FREQUENCY)
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= MIN_POSITIVE_VALUE) {
    return Result.fail({ _tag: 'MinecraftSoundPlayOptionsFailure', field: 'frequency', message: 'Frequency must be finite and positive' })
  }
  return Result.succeed(makeAudioFrequencyHz(value))
}

const positiveDuration = (value: unknown): Result.Result<AudioDurationSecs, MinecraftSoundPlayOptionsFailure> => {
  if (isMissing(value)) {
    return Result.succeed(DEFAULT_DURATION_SECS)
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= MIN_POSITIVE_VALUE) {
    return Result.fail({ _tag: 'MinecraftSoundPlayOptionsFailure', field: 'durationSecs', message: 'Duration must be finite and positive' })
  }
  return Result.succeed(makeAudioDurationSecs(value))
}

const captionReason = (enabled: boolean, availability: AudioAvailability): CaptionReason => {
  if (!enabled) {
    return 'muted'
  }
  if (availability === 'locked') {
    return 'gate-blocked'
  }
  if (availability === 'unavailable') {
    return 'unavailable'
  }
  return 'audible'
}

const soundSpatialisation = (
  sound: ResolvedMinecraftSound,
  options: MinecraftSoundPlayOptions,
): Spatialisation => {
  const { listenerForward, position } = options
  const listener = options.listener ?? options.camera?.position
  if (isMissing(position) || isMissing(listener)) {
    return NO_SPATIALISATION
  }
  return minecraftSpatialise(listener, position, {
    distanceScale: sound.attenuationDistance,
    listenerForward,
  })
}

const soundEffectGain = (
  sound: ResolvedMinecraftSound,
  spatial: Spatialisation,
  options: MinecraftSoundPlayOptions,
): AudioGain => {
  const input: SfxGainInput = {
    baseGain: sound.volume,
    sfxVolume: options.sfxVolume ?? DEFAULT_SFX_VOLUME,
    spatialGain: spatial.gain,
  }
  if (!isMissing(options.gainScale)) {
    return effectiveSfxGain({ ...input, gainScale: options.gainScale })
  }
  return effectiveSfxGain(input)
}

type SfxGainInput = {
  readonly baseGain: AudioGain
  readonly sfxVolume: AudioVolume
  readonly spatialGain: AudioVolume
  readonly gainScale?: AudioGain
}

type CaptionForOptions = {
  readonly atSecs: CaptionEvent['atSecs']
  readonly eventId: MinecraftSoundEventId
  readonly options: MinecraftSoundPlayOptions
  readonly pan: AudioPan
  readonly reason: CaptionReason
  readonly text: string
}

type EmitCaptionInput = {
  readonly availability: AudioAvailability
  readonly enabled: boolean
  readonly eventId: MinecraftSoundEventId
  readonly options: MinecraftSoundPlayOptions | undefined
  readonly plan: MinecraftSoundPlaybackPlan
}

const captionFor = ({ atSecs, eventId, options, pan, reason, text }: CaptionForOptions): CaptionEvent => {
  const caption: CaptionEvent = { atSecs, cueId: eventId, reason, text }
  const { position } = options
  const listener = options.listener ?? options.camera?.position
  if (isMissing(position) || isMissing(listener)) {
    return caption
  }
  return { ...caption, pan }
}

export const planMinecraftSound = (
  registry: MinecraftSoundRegistry,
  eventId: MinecraftSoundEventId,
  options: MinecraftSoundPlayOptions = {},
): Result.Result<MinecraftSoundPlaybackPlan, MinecraftSoundResolutionFailure | MinecraftSoundPlayOptionsFailure> => Result.gen(function* planMinecraftSoundEffect() {
    const frequency = yield* positiveFrequency(options.frequency)
    const durationSecs = yield* positiveDuration(options.durationSecs)
    const sound = yield* resolveMinecraftSound(registry, eventId, options.random ?? DEFAULT_RANDOM)
    const spatial = soundSpatialisation(sound, options)
    const event = registry.events.get(eventId)

    return {
      eventId,
      request: {
        durationSecs,
        frequency,
        gain: soundEffectGain(sound, spatial, options),
        loop: options.loop ?? false,
        naturalDuration: sound.stream,
        pan: spatial.pan,
        playbackRate: sound.pitch,
        soundId: sound.soundId,
        stream: sound.stream,
      },
      sound,
      subtitle: event?.subtitle ?? null,
    }
  })

const playbackError = (eventId: MinecraftSoundEventId, cause: unknown): MinecraftSoundPlaybackError => ({
  _tag: 'MinecraftSoundPlaybackError',
  cause,
  eventId,
})

const playbackHandle = (playback: TonePlayback): ToneHandle | null => {
  if (!playback.accepted) {
    return null
  }
  return { id: playback.id }
}

export const makeMinecraftSoundPlayer = (
  registry: MinecraftSoundRegistry,
  randomSource: () => number,
): Effect.Effect<MinecraftSoundPlayer, never, AudioBackendPort | CaptionStream | ClockPort> =>
  Effect.gen(function* buildMinecraftSoundPlayer() {
    const backend = yield* AudioBackendPort
    const captions = yield* CaptionStream
    const clock = yield* ClockPort

    const emitCaption = ({
      availability,
      enabled,
      eventId,
      options,
      plan,
    }: EmitCaptionInput): Effect.Effect<void> =>
      Effect.gen(function* emitMinecraftSoundCaption() {
        if (plan.subtitle === null) {
          return
        }
        const atSecs = yield* clock.monotonicSecs
        yield* captions.emit(captionFor({
          atSecs,
          eventId,
          options: options ?? {},
          pan: plan.request.pan,
          reason: captionReason(enabled, availability),
          text: plan.subtitle,
        }))
      })

    return {
      play: (eventId: MinecraftSoundEventId, options?: MinecraftSoundPlayOptions) =>
        Effect.gen(function* playMinecraftSound() {
          const plan = yield* Effect.fromResult(planMinecraftSound(registry, eventId, {
            ...options,
            random: options?.random ?? randomSource(),
          })).pipe(Effect.mapError((cause) => playbackError(eventId, cause)))
          const availability = yield* backend.availability
          const enabled = options?.enabled ?? true
          yield* emitCaption({ availability, enabled, eventId, options, plan })

          if (!enabled || availability !== 'ready') {
            return { ...plan, handle: null, played: false }
          }

          const playback: TonePlayback = yield* backend.playTone(plan.request)
          return { ...plan, handle: playbackHandle(playback), played: playback.accepted }
        }),
      stop: (playback: MinecraftSoundPlayback) => {
        if (playback.handle === null) {
          return Effect.void
        }
        return backend.stopTone(playback.handle)
      },
    }
  })

import {
  type AudioAvailability,
  AudioBackendPort,
  type ToneHandle,
  type ToneRequest,
} from './backend-port.js'
import { type CameraPoseSnapshot, ClockPort, type Position } from '@nerima-games/mc-kernel'
import { type CaptionEvent, type CaptionReason, CaptionStream } from './caption.js'
import {
  type MinecraftSoundRegistry,
  type ResolvedMinecraftSound,
  resolveMinecraftSound,
} from './minecraft-sounds.js'
import { NO_SPATIALISATION, type Spatialisation, effectiveSfxGain, spatialise } from './volume.js'
import { Effect } from 'effect'

const DEFAULT_FREQUENCY = 440
const DEFAULT_DURATION_SECS = 0.12
const DEFAULT_SFX_VOLUME = 1
const DEFAULT_RANDOM = 0
const MIN_POSITIVE_VALUE = 0

export type MinecraftSoundPlayOptions = {
  readonly random?: number
  readonly position?: Position
  readonly listener?: Position
  readonly camera?: CameraPoseSnapshot
  readonly listenerForward?: Position
  readonly enabled?: boolean
  readonly gainScale?: number
  readonly sfxVolume?: number
  readonly frequency?: number
  readonly durationSecs?: number
  readonly loop?: boolean
}

export type MinecraftSoundPlaybackPlan = {
  readonly eventId: string
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
  readonly eventId: string
  readonly cause: unknown
}

export type MinecraftSoundPlayer = {
  readonly play: (
    eventId: string,
    options?: MinecraftSoundPlayOptions,
  ) => Effect.Effect<MinecraftSoundPlayback, MinecraftSoundPlaybackError>
  readonly stop: (playback: MinecraftSoundPlayback) => Effect.Effect<void>
}

const isMissing = (value: unknown): value is undefined => Object.is(value, globalThis.undefined)

const positiveOrDefault = (value: number | undefined, fallback: number): number => {
  if (!isMissing(value) && Number.isFinite(value) && value > MIN_POSITIVE_VALUE) {
    return value
  }
  return fallback
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
  return spatialise(listener, position, {
    distanceScale: sound.attenuationDistance,
    listenerForward,
  })
}

const soundEffectGain = (
  sound: ResolvedMinecraftSound,
  spatial: Spatialisation,
  options: MinecraftSoundPlayOptions,
): number => {
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
  readonly baseGain: number
  readonly sfxVolume: number
  readonly spatialGain: number
  readonly gainScale?: number
}

type CaptionForOptions = {
  readonly atSecs: CaptionEvent['atSecs']
  readonly eventId: string
  readonly options: MinecraftSoundPlayOptions
  readonly pan: number
  readonly reason: CaptionReason
  readonly text: string
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
  eventId: string,
  options: MinecraftSoundPlayOptions = {},
): MinecraftSoundPlaybackPlan => {
  const sound = resolveMinecraftSound(registry, eventId, options.random ?? DEFAULT_RANDOM)
  const spatial = soundSpatialisation(sound, options)
  const event = registry.events[eventId]

  return {
    eventId,
    request: {
      durationSecs: positiveOrDefault(options.durationSecs, DEFAULT_DURATION_SECS),
      frequency: positiveOrDefault(options.frequency, DEFAULT_FREQUENCY),
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
}

const playbackError = (eventId: string, cause: unknown): MinecraftSoundPlaybackError => ({
  _tag: 'MinecraftSoundPlaybackError',
  cause,
  eventId,
})

export const makeMinecraftSoundPlayer = (
  registry: MinecraftSoundRegistry,
  randomSource: () => number,
): Effect.Effect<MinecraftSoundPlayer, never, AudioBackendPort | CaptionStream | ClockPort> =>
  Effect.gen(function* buildMinecraftSoundPlayer() {
    const backend = yield* AudioBackendPort
    const captions = yield* CaptionStream
    const clock = yield* ClockPort

    return {
      play: (eventId: string, options?: MinecraftSoundPlayOptions) =>
        Effect.gen(function* playMinecraftSound() {
          const plan = yield* Effect.try({
            catch: (cause): MinecraftSoundPlaybackError => playbackError(eventId, cause),
            try: () =>
              planMinecraftSound(registry, eventId, {
                ...options,
                random: options?.random ?? randomSource(),
              }),
          })
          const availability = yield* backend.availability
          const enabled = options?.enabled ?? true

          if (plan.subtitle !== null) {
            const atSecs = yield* clock.monotonicSecs
            yield* captions.emit(captionFor({
              atSecs,
              eventId,
              options: options ?? {},
              pan: plan.request.pan,
              reason: captionReason(enabled, availability),
              text: plan.subtitle,
            }))
          }

          if (!enabled || availability !== 'ready') {
            return { ...plan, handle: null, played: false }
          }

          const handle = yield* backend.playTone(plan.request)
          return { ...plan, handle, played: true }
        }),
      stop: (playback: MinecraftSoundPlayback) => {
        if (playback.handle === null) {
          return Effect.void
        }
        return backend.stopTone(playback.handle)
      },
    }
  })

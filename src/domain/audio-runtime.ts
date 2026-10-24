import { type AudioBackend, AudioBackendPort } from './backend-port.js'
import {
  type AudioRuntimeCaptionSignature,
  type AudioVolume,
  AudioVolume as audioVolume,
  AudioRuntimeCaptionSignature as makeAudioRuntimeCaptionSignature,
} from './audio-brands.js'
import { CAPTION_DISPLAY_SECS, type CaptionEvent, visibleCaptions } from './caption.js'
import { type CuePlayOptions, type SoundCueId } from './cue.js'
import { Effect, Layer, Ref } from 'effect'
import { type GameAudioHost, makeGameAudioHost } from './game-audio.js'
import { type Position, PositionAxis as positionAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import { makeSoundCueService, recordingCaptionLayer } from './engine.js'
import type { AngleRadians } from '@nerima-games/mc-kernel/domain/shared-vocabulary'
import type { ClockPort } from '@nerima-games/mc-kernel/domain/clock'
import type { MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'
import type { WebAudioBackend } from './webaudio-backend-types.js'

type RuntimeBackend = AudioBackend & Pick<WebAudioBackend, 'unlock' | 'dispose' | 'preloadSamples'>

const ZERO = 0
const DEFAULT_MASTER_VOLUME = 0.8
const FULL_VOLUME = 1

export type AudioRuntimeSnapshot = {
  readonly cueIds: ReadonlyArray<SoundCueId>
  readonly captions: ReadonlyArray<CaptionEvent>
  readonly listener: Position
  readonly listenerForward?: Position
  readonly closed: boolean
  readonly unlockPending: boolean
}

export const horizontalListenerForward = (yawRadians: AngleRadians): Position => ({
  x: positionAxis(-Math.sin(yawRadians)),
  y: positionAxis(ZERO),
  z: positionAxis(-Math.cos(yawRadians)),
})

export type AudioRuntimeSettings = {
  readonly masterVolume: AudioVolume
  readonly sfxVolume: AudioVolume
  readonly audioEnabled: boolean
}

export type AudioRuntime = {
  readonly game: GameAudioHost
  readonly play: (cueId: SoundCueId, options?: CuePlayOptions) => Effect.Effect<void>
  readonly unlock: () => Effect.Effect<void>
  readonly visible: (nowSecs: MonotonicTimeSecs) => Effect.Effect<ReadonlyArray<CaptionEvent>>
  readonly snapshot: (nowSecs: MonotonicTimeSecs) => Effect.Effect<AudioRuntimeSnapshot>
  readonly configure: (settings: AudioRuntimeSettings) => Effect.Effect<void>
  readonly close: () => Effect.Effect<void>
}

type AudioRuntimeState = {
  readonly cueIds: ReadonlyArray<SoundCueId>
  readonly settings: AudioRuntimeSettings
  readonly closed: boolean
  readonly unlocked: boolean
  readonly unlockPending: boolean
}

const DEFAULT_AUDIO_RUNTIME_SETTINGS: AudioRuntimeSettings = {
  audioEnabled: true,
  masterVolume: audioVolume(DEFAULT_MASTER_VOLUME),
  sfxVolume: audioVolume(FULL_VOLUME),
}

export const pruneExpiredCaptionEvents = (
  captions: ReadonlyArray<CaptionEvent>,
  nowSecs: MonotonicTimeSecs,
): ReadonlyArray<CaptionEvent> =>
  captions.filter(
    (caption) => nowSecs < caption.atSecs || nowSecs - caption.atSecs < CAPTION_DISPLAY_SECS,
  )

export const makeAudioRuntime = (input: {
  readonly backend: RuntimeBackend
  readonly clockLayer: Layer.Layer<ClockPort>
  readonly listener: () => Position
  readonly listenerForward?: () => Position
  readonly settings?: AudioRuntimeSettings
}): Effect.Effect<AudioRuntime> =>
  Effect.gen(function* makeAudioRuntimeEffect() {
    const captionEvents = yield* Ref.make<ReadonlyArray<CaptionEvent>>([])
    const state = yield* Ref.make<AudioRuntimeState>({
      closed: false,
      cueIds: [],
      settings: input.settings ?? DEFAULT_AUDIO_RUNTIME_SETTINGS,
      unlockPending: false,
      unlocked: false,
    })
    const layer = Layer.mergeAll(
      Layer.succeed(AudioBackendPort, input.backend),
      recordingCaptionLayer((event) => Ref.update(captionEvents, (events) => [...events, event])),
      input.clockLayer,
    )
    const service = yield* makeSoundCueService({
      context: Effect.gen(function* buildCueContext() {
        const current = yield* Ref.get(state)
        const availability = yield* input.backend.availability
        const settings = {
          master: current.settings.masterVolume,
          music: audioVolume(ZERO),
          sfx: current.settings.sfxVolume,
        }
        const context = {
          availability,
          enabled: current.settings.audioEnabled,
          listener: input.listener(),
          settings: {
            master: settings.master,
            music: settings.music,
            sfx: settings.sfx,
          },
        }
        if (input.listenerForward) {
          return { ...context, listenerForward: input.listenerForward() }
        }
        return context
      }),
    }).pipe(Effect.provide(layer))

    const currentCaptions = (nowSecs: MonotonicTimeSecs): Effect.Effect<ReadonlyArray<CaptionEvent>> =>
      Ref.modify(captionEvents, (events) => {
        const retained = pruneExpiredCaptionEvents(events, nowSecs)
        return [visibleCaptions(retained, nowSecs), retained]
      })

    return {
      close: () =>
        Effect.flatMap(
          Ref.modify(state, (current): readonly [boolean, AudioRuntimeState] => {
            if (current.closed) {
              return [false, current]
            }
            return [true, { ...current, closed: true }]
          }),
          (accepted) => {
            if (accepted) {
              return input.backend.dispose
            }
            return Effect.void
          },
        ),
      configure: (settings) =>
        Effect.flatMap(
          Ref.modify(state, (current): readonly [boolean, AudioRuntimeState] => {
            if (current.closed) {
              return [false, current]
            }
            return [true, { ...current, settings }]
          }),
          (accepted) => {
            if (accepted) {
              if (settings.audioEnabled) {
                const { masterVolume } = settings
                return input.backend.setMasterGain(masterVolume)
              }
              return input.backend.setMasterGain(audioVolume(ZERO))
            }
            return Effect.void
          },
        ),
      game: makeGameAudioHost(service),
      play: (cueId, options) =>
        Effect.flatMap(
          Ref.modify(state, (current): readonly [boolean, AudioRuntimeState] => {
            if (current.closed) {
              return [false, current]
            }
            return [true, { ...current, cueIds: [...current.cueIds, cueId] }]
          }),
          (accepted) => {
            if (accepted) {
              return service.play(cueId, options)
            }
            return Effect.void
          },
        ),
      snapshot: (nowSecs) =>
        Effect.gen(function* createSnapshot() {
          const current = yield* Ref.get(state)
          const captions = yield* currentCaptions(nowSecs)
          const listener = input.listener()
          const result = {
            captions,
            closed: current.closed,
            cueIds: [...current.cueIds],
            listener,
            unlockPending: current.unlockPending,
          }
          if (input.listenerForward) {
            return { ...result, listenerForward: input.listenerForward() }
          }
          return result
        }),
      unlock: () =>
        Effect.flatMap(
          Ref.modify(state, (current): readonly [boolean, AudioRuntimeState] => {
            if (current.closed || current.unlocked || current.unlockPending) {
              return [false, current]
            }
            return [true, { ...current, unlockPending: true }]
          }),
          (claimed) => {
            if (claimed) {
              return Effect.gen(function* unlockAudio() {
                const availability = yield* input.backend.unlock
                yield* input.backend.preloadSamples()
                if (availability === 'ready') {
                  yield* Ref.update(state, (current) => ({ ...current, unlocked: true }))
                }
              }).pipe(
                Effect.ensuring(Ref.update(state, (current) => ({ ...current, unlockPending: false }))),
              )
            }
            return Effect.void
          },
        ),
      visible: currentCaptions,
    }
  })

export const captionRenderSignature = (captions: ReadonlyArray<CaptionEvent>): AudioRuntimeCaptionSignature =>
  makeAudioRuntimeCaptionSignature(
    JSON.stringify(captions.map(({ cueId, text, reason, atSecs }) => [cueId, text, reason, atSecs])) ?? '[]',
  )

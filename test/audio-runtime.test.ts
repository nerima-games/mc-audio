import { AngleRadians } from '@nerima-games/mc-kernel/domain/shared-vocabulary'
import { EpochMillis, MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'
import { PositionAxis, type Position } from '@nerima-games/mc-kernel/domain/coordinates'
import { FixedClockLayer, type ClockPort } from '@nerima-games/mc-kernel/domain/clock'
import { describe, expect, it } from '@effect/vitest'
import { Effect, type Layer } from 'effect'
import { AudioCaptionText, AudioCount, AudioVolume } from '../src/domain/audio-brands'
import { makeRecordingBackend, type AudioAvailability, type AudioBackend } from '../src/domain/backend-port'
import {
  captionRenderSignature,
  horizontalListenerForward,
  makeAudioRuntime,
  pruneExpiredCaptionEvents,
} from '../src/domain/audio-runtime'
import { SoundCueId } from '../src/domain/cue'
import type { WebAudioBackend, WebAudioReport } from '../src/domain/webaudio-backend-types'

const testPosition: Position = {
  x: PositionAxis(0),
  y: PositionAxis(0),
  z: PositionAxis(0),
}

const fixedClockLayer = (atSecs: number): Layer.Layer<ClockPort> =>
  FixedClockLayer({
    monotonicSecs: MonotonicTimeSecs(atSecs),
    wallClockEpochMillis: EpochMillis(0),
  })

const report: WebAudioReport = {
  availability: 'ready',
  contextState: 'running',
  constructorName: 'AudioContext',
  contextAttempted: true,
  unlockAttempts: AudioCount(0),
  unlockRefusals: AudioCount(0),
  refusedTones: AudioCount(0),
  capacityRefusals: AudioCount(0),
  activeTones: AudioCount(0),
  spontaneousStateChanges: AudioCount(0),
  muted: false,
  disposed: false,
}

const makeBackend = (availability: AudioAvailability, unlockResults: ReadonlyArray<AudioAvailability> = ['ready']) =>
  Effect.gen(function* () {
    const recording = yield* makeRecordingBackend(availability)
    let unlockCount = 0
    let preloadCount = 0
    let disposeCount = 0
    const backend: AudioBackend & Pick<WebAudioBackend, 'unlock' | 'dispose' | 'preloadSamples' | 'report'> = {
      ...recording.backend,
      unlock: Effect.sync(() => {
        const result = unlockResults[unlockCount] ?? 'ready'
        unlockCount += 1
        return result
      }),
      preloadSamples: () =>
        Effect.sync(() => {
          preloadCount += 1
          return { requested: AudioCount(0), loaded: AudioCount(0), cached: AudioCount(0), failed: AudioCount(0) }
        }),
      dispose: Effect.sync(() => {
        disposeCount += 1
      }),
      report: Effect.succeed(report),
    }
    return {
      backend,
      recording,
      lifecycle: () => ({ unlockCount, preloadCount, disposeCount }),
    }
  })

describe('audio runtime', () => {
  it.effect('derives the horizontal listener direction from branded camera yaw', () =>
    Effect.sync(() => {
      expect(horizontalListenerForward(AngleRadians(0))).toEqual({
        x: PositionAxis(-0),
        y: PositionAxis(0),
        z: PositionAxis(-1),
      })
      expect(horizontalListenerForward(AngleRadians(Math.PI / 2)).x).toBeCloseTo(-1)
      expect(horizontalListenerForward(AngleRadians(-Math.PI / 2)).x).toBeCloseTo(1)
    }),
  )

  it.effect('returns Effect operations and preserves captions, settings, and listener state', () =>
    Effect.gen(function* () {
      const setup = yield* makeBackend('locked')
      const runtime = yield* makeAudioRuntime({
        backend: setup.backend,
        clockLayer: fixedClockLayer(12),
        listener: () => testPosition,
        listenerForward: () => horizontalListenerForward(AngleRadians(0)),
      })

      yield* runtime.configure({ masterVolume: AudioVolume(0.4), sfxVolume: AudioVolume(0.25), audioEnabled: true })
      yield* runtime.play(SoundCueId('playerHurt'))
      const visible = yield* runtime.visible(MonotonicTimeSecs(12))
      const snapshot = yield* runtime.snapshot(MonotonicTimeSecs(12))
      const masterGains = yield* setup.recording.masterGains
      const played = yield* setup.recording.played

      expect(visible).toMatchObject([{ cueId: 'playerHurt', atSecs: 12, reason: 'gate-blocked' }])
      expect(snapshot).toMatchObject({
        cueIds: ['playerHurt'],
        captions: visible,
        listener: testPosition,
        listenerForward: horizontalListenerForward(AngleRadians(0)),
        closed: false,
        unlockPending: false,
      })
      expect(masterGains).toEqual([0.4])
      expect(played).toEqual([])
      expect(yield* runtime.visible(MonotonicTimeSecs(14.5))).toEqual([])
    }),
  )

  it.effect('omits optional listener direction and mutes the master gain when audio is disabled', () =>
    Effect.gen(function* () {
      const setup = yield* makeBackend('ready')
      const runtime = yield* makeAudioRuntime({
        backend: setup.backend,
        clockLayer: fixedClockLayer(0),
        listener: () => testPosition,
      })

      yield* runtime.play(SoundCueId('playerHurt'))
      yield* runtime.configure({ masterVolume: AudioVolume(0.6), sfxVolume: AudioVolume(0.5), audioEnabled: false })

      const snapshot = yield* runtime.snapshot(MonotonicTimeSecs(0))
      expect(snapshot).not.toHaveProperty('listenerForward')
      expect(yield* setup.recording.masterGains).toEqual([0])
    }),
  )

  it.effect('ignores game emissions after close', () =>
    Effect.gen(function* () {
      const setup = yield* makeBackend('ready')
      const runtime = yield* makeAudioRuntime({
        backend: setup.backend,
        clockLayer: fixedClockLayer(12),
        listener: () => testPosition,
      })

      yield* runtime.close()
      yield* runtime.game.emit({ cueId: SoundCueId('playerHurt') })
      const snapshot = yield* runtime.snapshot(MonotonicTimeSecs(12))

      expect(snapshot).toMatchObject({ captions: [], closed: true, cueIds: [] })
      expect(yield* setup.recording.played).toEqual([])
    }),
  )

  it.effect('unlocks, preloads, closes once, and ignores operations after close', () =>
    Effect.gen(function* () {
      const setup = yield* makeBackend('locked', ['locked', 'ready'])
      const runtime = yield* makeAudioRuntime({
        backend: setup.backend,
        clockLayer: fixedClockLayer(0),
        listener: () => testPosition,
        settings: { masterVolume: AudioVolume(0.8), sfxVolume: AudioVolume(0.75), audioEnabled: true },
      })

      yield* runtime.unlock()
      yield* runtime.unlock()
      yield* runtime.unlock()
      yield* runtime.close()
      yield* runtime.close()
      yield* runtime.play(SoundCueId('playerHurt'))
      yield* runtime.configure({ masterVolume: AudioVolume(0.9), sfxVolume: AudioVolume(1), audioEnabled: false })
      yield* runtime.unlock()

      expect(setup.lifecycle()).toEqual({ unlockCount: 2, preloadCount: 2, disposeCount: 1 })
      expect(yield* runtime.snapshot(MonotonicTimeSecs(0))).toMatchObject({ cueIds: [], closed: true })
      expect(yield* setup.recording.masterGains).toEqual([])
    }),
  )

  it.effect('retains future captions and expires captions at the display boundary', () =>
    Effect.sync(() => {
      const captions = [
        { cueId: SoundCueId('playerHurt'), text: AudioCaptionText('Old'), reason: 'audible' as const, atSecs: MonotonicTimeSecs(0) },
        { cueId: SoundCueId('inventoryOpen'), text: AudioCaptionText('Current'), reason: 'audible' as const, atSecs: MonotonicTimeSecs(2) },
        { cueId: SoundCueId('inventoryClose'), text: AudioCaptionText('Future'), reason: 'audible' as const, atSecs: MonotonicTimeSecs(8) },
      ]

      expect(pruneExpiredCaptionEvents(captions, MonotonicTimeSecs(4)).map((caption) => caption.text)).toEqual([
        'Current',
        'Future',
      ])
      expect(pruneExpiredCaptionEvents(captions, MonotonicTimeSecs(4.5)).map((caption) => caption.text)).toEqual([
        'Future',
      ])
      expect(captionRenderSignature([])).toBe('[]')
      expect(captionRenderSignature(captions.slice(1, 2))).toBe('[["inventoryOpen","Current","audible",2]]')

      const stringify = JSON.stringify
      Object.defineProperty(JSON, 'stringify', { configurable: true, value: () => undefined })
      try {
        expect(captionRenderSignature([])).toBe('[]')
      } finally {
        Object.defineProperty(JSON, 'stringify', { configurable: true, writable: true, value: stringify })
      }
    }),
  )
})

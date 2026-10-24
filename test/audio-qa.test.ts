import { EpochMillis, MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'
import type { ClockService } from '@nerima-games/mc-kernel/domain/clock'
import { PositionAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeAudioQaEntrypoint } from '../src/entrypoints/audio-qa'
import { makeAudioQaSurface } from '../src/qa/audio'
import { AudioCount } from '../src/domain/audio-brands'
import { SoundCueId } from '../src/domain/cue'
import type { AudioRuntimeSnapshot } from '../src/domain/audio-runtime'
import type { WebAudioReport } from '../src/domain/webaudio-backend-types'

const report: WebAudioReport = {
  availability: 'ready',
  contextState: 'running',
  constructorName: 'AudioContext',
  contextAttempted: true,
  unlockAttempts: AudioCount(1),
  unlockRefusals: AudioCount(0),
  refusedTones: AudioCount(0),
  capacityRefusals: AudioCount(0),
  activeTones: AudioCount(0),
  spontaneousStateChanges: AudioCount(0),
  muted: false,
  disposed: false,
}

const snapshot: AudioRuntimeSnapshot = {
  cueIds: [SoundCueId('playerHurt')],
  captions: [],
  listener: { x: PositionAxis(0), y: PositionAxis(0), z: PositionAxis(0) },
  closed: false,
  unlockPending: false,
}

const clock: ClockService = {
  monotonicSecs: Effect.succeed(MonotonicTimeSecs(14)),
  wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
}

const makeDependencies = () => {
  const snapshotCalls: Array<MonotonicTimeSecs> = []
  return {
    snapshotCalls,
    dependencies: {
      backend: { report: Effect.succeed(report) },
      runtime: {
        snapshot: (nowSecs: MonotonicTimeSecs) =>
          Effect.sync(() => {
            snapshotCalls.push(nowSecs)
            return snapshot
          }),
      },
      clock,
    },
  }
}

describe('audio QA provider', () => {
  it.effect('provides Effect commands for report and a clocked runtime snapshot', () =>
    Effect.gen(function* () {
      const { dependencies, snapshotCalls } = makeDependencies()
      const surface = makeAudioQaSurface(dependencies)

      expect(surface.namespace).toBe('audio')
      expect(yield* surface.commands.report()).toEqual(report)
      expect(yield* surface.commands.snapshot()).toEqual(snapshot)
      expect(snapshotCalls).toEqual([MonotonicTimeSecs(14)])
    }),
  )

  it.effect('interprets the QA Effects at its package entrypoint', () =>
    Effect.sync(() => {
      const { dependencies, snapshotCalls } = makeDependencies()
      const entrypoint = makeAudioQaEntrypoint(dependencies)

      expect(entrypoint.namespace).toBe('audio')
      expect(entrypoint.commands.report()).toEqual(report)
      expect(entrypoint.commands.snapshot()).toEqual(snapshot)
      expect(snapshotCalls).toEqual([MonotonicTimeSecs(14)])
    }),
  )
})

import type { AudioRuntime, AudioRuntimeSnapshot } from '../domain/audio-runtime.js'
import type { WebAudioBackend, WebAudioReport } from '../domain/webaudio-backend-types.js'
import type { ClockService } from '@nerima-games/mc-kernel/domain/clock'
import { Effect } from 'effect'
import type { MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'

export type AudioQaDependencies = {
  readonly backend: Pick<WebAudioBackend, 'report'>
  readonly runtime: Pick<AudioRuntime, 'snapshot'>
  readonly clock: Pick<ClockService, 'monotonicSecs'>
}

export type AudioQaSurface = {
  readonly namespace: 'audio'
  readonly commands: {
    readonly report: () => Effect.Effect<WebAudioReport>
    readonly snapshot: () => Effect.Effect<AudioRuntimeSnapshot>
  }
}

export const makeAudioQaSurface = (dependencies: AudioQaDependencies): AudioQaSurface => ({
  commands: {
    report: () => dependencies.backend.report,
    snapshot: () =>
      Effect.flatMap(dependencies.clock.monotonicSecs, (nowSecs: MonotonicTimeSecs) =>
        dependencies.runtime.snapshot(nowSecs),
      ),
  },
  namespace: 'audio',
})

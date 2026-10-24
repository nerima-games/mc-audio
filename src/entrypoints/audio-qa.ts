import {
  type AudioQaDependencies,
  makeAudioQaSurface,
} from '../qa/audio.js'
import type { AudioRuntimeSnapshot } from '../domain/audio-runtime.js'
import { Effect } from 'effect'
import type { WebAudioReport } from '../domain/webaudio-backend-types.js'

export type AudioQaEntrypoint = {
  readonly namespace: 'audio'
  readonly commands: {
    readonly report: () => WebAudioReport
    readonly snapshot: () => AudioRuntimeSnapshot
  }
}

export const makeAudioQaEntrypoint = (dependencies: AudioQaDependencies): AudioQaEntrypoint => {
  const surface = makeAudioQaSurface(dependencies)
  return {
    commands: {
      report: () => Effect.runSync(surface.commands.report()),
      snapshot: () => Effect.runSync(surface.commands.snapshot()),
    },
    namespace: surface.namespace,
  }
}

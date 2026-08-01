import type { CuePlayOptions, SoundCueId } from './cue'
import type { Effect } from 'effect'
import type { SoundCueService } from './engine'

/** Stable host ingress: game systems emit semantic cues, never WebAudio nodes. */
export type GameAudioEvent = CuePlayOptions & {
  readonly cueId: SoundCueId
}

export type GameAudioHost = {
  readonly emit: (event: GameAudioEvent) => Effect.Effect<void>
}

export const makeGameAudioHost = (cues: SoundCueService): GameAudioHost => ({
  emit: ({ cueId, ...options }) => cues.play(cueId, options),
})

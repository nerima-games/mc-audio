/* oxlint-disable func-names, id-length, no-magic-numbers -- Effect generator tests use framework callbacks and concise spatial coordinates. */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { PositionAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import { AudioGain } from '../src/domain/audio-brands'
import { SoundCueId } from '../src/domain/cue'
import type { SoundCueService } from '../src/domain/engine'
import { makeGameAudioHost } from '../src/domain/game-audio'

describe('game audio host', () => {
  it.effect('forwards semantic game events to the cue service', () =>
    Effect.gen(function* () {
      const calls: Array<Parameters<SoundCueService['play']>> = []
      const host = makeGameAudioHost({
        play: (cueId, options) => Effect.sync(() => {
          calls.push([cueId, options])
        }),
      })

      yield* host.emit({
        cueId: SoundCueId('blockBreak'),
        gainScale: AudioGain(0.5),
        position: { x: PositionAxis(1), y: PositionAxis(2), z: PositionAxis(3) },
      })

      expect(calls).toStrictEqual([
        [SoundCueId('blockBreak'), {
          gainScale: AudioGain(0.5),
          position: { x: PositionAxis(1), y: PositionAxis(2), z: PositionAxis(3) },
        }],
      ])
    }),
  )
})

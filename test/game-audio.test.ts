/* oxlint-disable func-names, id-length, no-magic-numbers -- Effect generator tests use framework callbacks and concise spatial coordinates. */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
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
        cueId: 'blockBreak',
        gainScale: 0.5,
        position: { x: 1, y: 2, z: 3 },
      })

      expect(calls).toStrictEqual([
        ['blockBreak', { gainScale: 0.5, position: { x: 1, y: 2, z: 3 } }],
      ])
    }),
  )
})

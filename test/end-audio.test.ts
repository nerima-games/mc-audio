/* oxlint-disable id-length, no-magic-numbers, no-ternary, sort-imports -- Compact spatial fixtures and gate matrices keep these planner tests readable. */
import { describe, expect, it } from 'vitest'
import {
  END_EVENT_HISTORY_LIMIT,
  type EndAudioEvent,
  type EndAudioEventKind,
  type EndAudioSnapshot,
  INITIAL_END_AUDIO_STATE,
  planEndAudio,
} from '../src/domain/end-audio'

const event = (kind: EndAudioEventKind, id: string = kind, x = 0): EndAudioEvent => ({
  id,
  kind,
  position: { x, y: 64, z: 0 },
})

const snapshot = (overrides: Partial<EndAudioSnapshot> = {}): EndAudioSnapshot => ({
  dimension: 'end',
  events: [],
  listener: { x: 0, y: 64, z: 0 },
  nowSecs: 10,
  phase: 'active',
  ...overrides,
})

describe('End audio planning', () => {
  it('runs End ambience only in the End and honours a zero sound limit', () => {
    expect(planEndAudio(snapshot()).loops).toStrictEqual([
      { fadeSecs: 1.25, gain: 0.18, kind: 'endAmbience' },
    ])
    expect(planEndAudio(snapshot({ dimension: 'overworld', phase: 'unstarted' })).loops).toStrictEqual([])
    expect(planEndAudio(snapshot({ maxSimultaneousSounds: 0 })).loops).toStrictEqual([])
  })

  it('spatialises deterministically with the shared distance attenuation policy', () => {
    const input = snapshot({ events: [event('dragonRoar', 'roar', 12)] })
    expect(planEndAudio(input)).toStrictEqual(planEndAudio(input))
    expect(planEndAudio(input).events[0]).toMatchObject({
      eventId: 'roar',
      gain: 0.45,
      kind: 'dragonRoar',
      pan: 1,
    })
  })

  it.each([
    ['eyeThrow', 'overworld', 'unstarted'],
    ['frameInsert', 'overworld', 'unstarted'],
    ['portalActivate', 'overworld', 'unstarted'],
    ['dragonFlap', 'end', 'active'],
    ['dragonRoar', 'end', 'active'],
    ['dragonHurt', 'end', 'active'],
    ['playerHit', 'end', 'active'],
    ['dragonDeath', 'end', 'dying'],
    ['exitPortal', 'end', 'defeated'],
    ['dragonReward', 'end', 'defeated'],
  ] as const)('gates %s to its dimension and battle phase', (kind, dimension, phase) => {
    const allowed = snapshot({ dimension, events: [event(kind)], phase })
    expect(planEndAudio(allowed).events.map((planned) => planned.kind)).toStrictEqual([kind])

    const wrongDimension = dimension === 'end' ? 'overworld' : 'end'
    expect(planEndAudio({ ...allowed, dimension: wrongDimension }).events).toStrictEqual([])
    const wrongPhase = phase === 'active' ? 'defeated' : 'active'
    expect(planEndAudio({ ...allowed, phase: wrongPhase }).events).toStrictEqual([])
  })

  it('deduplicates event ids and applies cooldowns across frames', () => {
    const first = planEndAudio(snapshot({ events: [event('dragonFlap', 'flap-1')] }))
    expect(first.events).toHaveLength(1)
    expect(
      planEndAudio(
        snapshot({ events: [event('dragonFlap', 'flap-1')], nowSecs: 10.1 }),
        first.nextState,
      ).events,
    ).toStrictEqual([])

    const coolingDown = planEndAudio(
      snapshot({ events: [event('dragonFlap', 'flap-2')], nowSecs: 10.1 }),
      first.nextState,
    )
    expect(coolingDown.events).toStrictEqual([])
    expect(
      planEndAudio(
        snapshot({ events: [event('dragonFlap', 'flap-3')], nowSecs: 10.22 }),
        coolingDown.nextState,
      ).events,
    ).toHaveLength(1)
  })

  it('uses stable priority ordering and counts ambience toward the simultaneous limit', () => {
    const plan = planEndAudio(
      snapshot({
        events: [
          event('dragonFlap'),
          event('dragonHurt'),
          event('dragonRoar'),
          event('playerHit'),
        ],
        maxSimultaneousSounds: 3,
      }),
    )
    expect(plan.events.map((planned) => planned.kind)).toStrictEqual(['playerHit', 'dragonRoar'])
  })

  it('reserves active sound slots until their deterministic end time', () => {
    const busyState = {
      ...INITIAL_END_AUDIO_STATE,
      activeUntilSecs: [11],
    }
    expect(
      planEndAudio(
        snapshot({ events: [event('dragonRoar')], maxSimultaneousSounds: 2 }),
        busyState,
      ).events,
    ).toStrictEqual([])
    expect(
      planEndAudio(
        snapshot({ events: [event('dragonRoar')], maxSimultaneousSounds: 2, nowSecs: 11 }),
        busyState,
      ).events,
    ).toHaveLength(1)
  })

  it('bounds deduplication history and consumes gated event ids', () => {
    const oldIds = Array.from({ length: END_EVENT_HISTORY_LIMIT }, (_, index) => `old-${index}`)
    const gated = planEndAudio(
      snapshot({ dimension: 'overworld', events: [event('dragonDeath', 'death')], phase: 'unstarted' }),
      { ...INITIAL_END_AUDIO_STATE, recentEventIds: oldIds },
    )
    expect(gated.events).toStrictEqual([])
    expect(gated.nextState.recentEventIds).toHaveLength(END_EVENT_HISTORY_LIMIT)
    expect(gated.nextState.recentEventIds.at(-1)).toBe('death')
    expect(
      planEndAudio(
        snapshot({ events: [event('dragonDeath', 'death')], phase: 'dying' }),
        gated.nextState,
      ).events,
    ).toStrictEqual([])
  })
})

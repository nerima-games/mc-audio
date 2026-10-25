/* oxlint-disable no-magic-numbers -- End sound timing, mix, priority, and fallback oscillator values are authored constants. */
import {
  type AudioCount,
  type AudioDurationSecs,
  type AudioEventId,
  type AudioFrequencyHz,
  type AudioGain,
  type AudioPan,
  type AudioWeight,
  AudioCount as audioCount,
  AudioDurationSecs as audioDurationSecs,
  AudioFrequencyHz as audioFrequencyHz,
  AudioGain as audioGain,
  AudioWeight as audioWeight,
} from './audio-brands.js'
import {
  type MonotonicTimeSecs,
  MonotonicTimeSecs as monotonicTimeSecs,
} from '@nerima-games/mc-kernel/domain/quantities'
import { clampNonNegative, spatialise } from './volume.js'
import { Option, Result } from 'effect'
import type { Position } from '@nerima-games/mc-kernel/domain/coordinates'

export const END_AUDIO_DIMENSIONS = ['overworld', 'nether', 'end'] as const
export type EndAudioDimension = (typeof END_AUDIO_DIMENSIONS)[number]

export const DRAGON_BATTLE_PHASES = ['unstarted', 'active', 'dying', 'defeated'] as const
export type DragonBattlePhase = (typeof DRAGON_BATTLE_PHASES)[number]

export const END_AUDIO_EVENT_KINDS = [
  'eyeThrow',
  'frameInsert',
  'portalActivate',
  'dragonFlap',
  'dragonRoar',
  'dragonHurt',
  'dragonDeath',
  'playerHit',
  'exitPortal',
  'dragonReward',
] as const

export type EndAudioEventKind = (typeof END_AUDIO_EVENT_KINDS)[number]
export type EndAudioLoopKind = 'endAmbience'

export type EndAudioEvent = {
  readonly id: AudioEventId
  readonly kind: EndAudioEventKind
  readonly position: Position
}

export type EndAudioSnapshot = {
  readonly dimension: EndAudioDimension
  readonly phase: DragonBattlePhase
  readonly nowSecs: MonotonicTimeSecs
  readonly listener: Position
  readonly listenerForward?: Position
  readonly events: ReadonlyArray<EndAudioEvent>
  readonly maxSimultaneousSounds?: AudioCount
}

export type EndAudioFallbackPlan = {
  readonly durationSecs: AudioDurationSecs
  readonly frequency: AudioFrequencyHz
  readonly gain: AudioGain
  readonly pan: AudioPan
  readonly wave: 'sine' | 'square' | 'sawtooth' | 'triangle'
}

export type EndAudioEventPlan = {
  readonly eventId: AudioEventId
  readonly fallback: EndAudioFallbackPlan
  readonly gain: AudioGain
  readonly kind: EndAudioEventKind
  readonly pan: AudioPan
}

export type EndAudioLoopPlan = {
  readonly fadeSecs: AudioDurationSecs
  readonly gain: AudioGain
  readonly kind: EndAudioLoopKind
}

export type EndAudioState = {
  readonly activeUntilSecs: ReadonlyArray<MonotonicTimeSecs>
  readonly lastPlayedAtSecs: Readonly<Partial<Record<EndAudioEventKind, MonotonicTimeSecs>>>
  readonly recentEventIds: ReadonlyArray<AudioEventId>
}

export type EndAudioPlan = {
  readonly events: ReadonlyArray<EndAudioEventPlan>
  readonly loops: ReadonlyArray<EndAudioLoopPlan>
  readonly nextState: EndAudioState
}

export type EndAudioClockFailure = {
  readonly _tag: 'EndAudioClockFailure'
}

type EndSoundDefinition = {
  readonly baseGain: AudioGain
  readonly cooldownSecs: AudioDurationSecs
  readonly durationSecs: AudioDurationSecs
  readonly fallbackFrequency: AudioFrequencyHz
  readonly fallbackWave: EndAudioFallbackPlan['wave']
  readonly priority: AudioWeight
}

const soundDefinition = (input: {
  readonly baseGain: number
  readonly cooldownSecs: number
  readonly durationSecs: number
  readonly fallbackFrequency: number
  readonly fallbackWave: EndAudioFallbackPlan['wave']
  readonly priority: number
}): EndSoundDefinition => ({
  baseGain: audioGain(input.baseGain),
  cooldownSecs: audioDurationSecs(input.cooldownSecs),
  durationSecs: audioDurationSecs(input.durationSecs),
  fallbackFrequency: audioFrequencyHz(input.fallbackFrequency),
  fallbackWave: input.fallbackWave,
  priority: audioWeight(input.priority),
})

export const END_SOUND_DEFINITIONS: Readonly<Record<EndAudioEventKind, EndSoundDefinition>> = {
  dragonDeath: soundDefinition({ baseGain: 0.95, cooldownSecs: 8, durationSecs: 4, fallbackFrequency: 48, fallbackWave: 'sawtooth', priority: 100 }),
  dragonFlap: soundDefinition({ baseGain: 0.58, cooldownSecs: 0.22, durationSecs: 0.38, fallbackFrequency: 72, fallbackWave: 'triangle', priority: 40 }),
  dragonHurt: soundDefinition({ baseGain: 0.76, cooldownSecs: 0.3, durationSecs: 0.45, fallbackFrequency: 95, fallbackWave: 'sawtooth', priority: 65 }),
  dragonReward: soundDefinition({ baseGain: 0.8, cooldownSecs: 5, durationSecs: 1.4, fallbackFrequency: 880, fallbackWave: 'triangle', priority: 90 }),
  dragonRoar: soundDefinition({ baseGain: 0.9, cooldownSecs: 2.5, durationSecs: 1.8, fallbackFrequency: 58, fallbackWave: 'sawtooth', priority: 70 }),
  exitPortal: soundDefinition({ baseGain: 0.72, cooldownSecs: 2, durationSecs: 1.2, fallbackFrequency: 660, fallbackWave: 'triangle', priority: 80 }),
  eyeThrow: soundDefinition({ baseGain: 0.48, cooldownSecs: 0.2, durationSecs: 0.35, fallbackFrequency: 740, fallbackWave: 'sine', priority: 45 }),
  frameInsert: soundDefinition({ baseGain: 0.55, cooldownSecs: 0.12, durationSecs: 0.3, fallbackFrequency: 520, fallbackWave: 'triangle', priority: 50 }),
  playerHit: soundDefinition({ baseGain: 0.78, cooldownSecs: 0.18, durationSecs: 0.16, fallbackFrequency: 130, fallbackWave: 'sawtooth', priority: 75 }),
  portalActivate: soundDefinition({ baseGain: 0.85, cooldownSecs: 3, durationSecs: 1.5, fallbackFrequency: 220, fallbackWave: 'sine', priority: 85 }),
}

export const INITIAL_END_AUDIO_STATE: EndAudioState = {
  activeUntilSecs: [],
  lastPlayedAtSecs: {},
  recentEventIds: [],
}

export const DEFAULT_MAX_SIMULTANEOUS_END_SOUNDS: AudioCount = audioCount(6)
export const END_AMBIENCE_FADE_SECS: AudioDurationSecs = audioDurationSecs(1.25)
export const END_AMBIENCE_GAIN: AudioGain = audioGain(0.18)
export const END_EVENT_HISTORY_LIMIT: AudioCount = audioCount(64)

const isEventAllowed = (
  kind: EndAudioEventKind,
  dimension: EndAudioDimension,
  phase: DragonBattlePhase,
): boolean => {
  switch (kind) {
    case 'eyeThrow':
    case 'frameInsert':
    case 'portalActivate':
      return dimension === 'overworld' && phase === 'unstarted'
    case 'dragonFlap':
    case 'dragonRoar':
    case 'dragonHurt':
    case 'playerHit':
      return dimension === 'end' && phase === 'active'
    case 'dragonDeath':
      return dimension === 'end' && phase === 'dying'
    case 'exitPortal':
    case 'dragonReward':
      return dimension === 'end' && phase === 'defeated'
    // Unreachable: the cases above already exhaust every EndAudioEventKind
    // Member, so `kind` is narrowed to `never` here. This arm exists only so
    // A future addition to END_AUDIO_EVENT_KINDS fails to compile instead of
    // Silently being allowed nowhere. The `@preserve` suffix keeps the ignore
    // Hint through esbuild's TypeScript transpile step (vitest 4 /
    // @vitest/coverage-v8 4.x strips comments lacking it before coverage
    // Instrumentation sees them).
    // oxlint-disable-next-line capitalized-comments
    /* v8 ignore start -- @preserve */
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
    // oxlint-disable-next-line capitalized-comments
    /* v8 ignore stop -- @preserve */
  }
}

const boundedSoundLimit = (value: AudioCount | undefined): number => {
  const requested = value ?? DEFAULT_MAX_SIMULTANEOUS_END_SOUNDS
  if (!Number.isFinite(requested)) {
    return 0
  }
  return Math.max(0, Math.floor(requested))
}

const rememberEventIds = (
  previous: ReadonlyArray<AudioEventId>,
  events: ReadonlyArray<EndAudioEvent>,
): ReadonlyArray<AudioEventId> => {
  const known = new Set(previous)
  const incoming = events.filter((event) => {
    const shouldRemember = event.id.length > 0 && !known.has(event.id)
    known.add(event.id)
    return shouldRemember
  }).map((event) => event.id)
  const remembered = [...previous, ...incoming]
  return remembered.slice(-END_EVENT_HISTORY_LIMIT)
}

const planEndLoops = (
  dimension: EndAudioDimension,
  maxSounds: number,
): ReadonlyArray<EndAudioLoopPlan> => {
  if (dimension !== 'end' || maxSounds === 0) {
    return []
  }
  return [{ fadeSecs: END_AMBIENCE_FADE_SECS, gain: END_AMBIENCE_GAIN, kind: 'endAmbience' }]
}

const eventCandidates = (
  snapshot: EndAudioSnapshot,
  previousIds: ReadonlySet<AudioEventId>,
): ReadonlyArray<EndAudioEvent> => snapshot.events
  .map((event, index) => ({ event, index }))
  .filter(({ event }) =>
    event.id.length > 0 &&
    !previousIds.has(event.id) &&
    isEventAllowed(event.kind, snapshot.dimension, snapshot.phase),
  )
  .sort((left, right) => {
    const priorityDifference =
      END_SOUND_DEFINITIONS[right.event.kind].priority -
      END_SOUND_DEFINITIONS[left.event.kind].priority
    if (priorityDifference === 0) {
      return left.index - right.index
    }
    return priorityDifference
  })
  .map(({ event }) => event)

const isOutsideCooldown = (
  kind: EndAudioEventKind,
  nowSecs: MonotonicTimeSecs,
  lastPlayedAtSecs: Readonly<Partial<Record<EndAudioEventKind, MonotonicTimeSecs>>>,
): boolean => {
  const lastPlayed = lastPlayedAtSecs[kind]
  return typeof lastPlayed !== 'number' || nowSecs - lastPlayed >= END_SOUND_DEFINITIONS[kind].cooldownSecs
}

const eventPlan = (event: EndAudioEvent, snapshot: EndAudioSnapshot): EndAudioEventPlan => {
  const definition = END_SOUND_DEFINITIONS[event.kind]
  const spatial = spatialise(snapshot.listener, event.position, {
    listenerForward: snapshot.listenerForward,
  })
  const gain = clampNonNegative(definition.baseGain * spatial.gain)
  return {
    eventId: event.id,
    fallback: {
      durationSecs: definition.durationSecs,
      frequency: definition.fallbackFrequency,
      gain,
      pan: spatial.pan,
      wave: definition.fallbackWave,
    },
    gain,
    kind: event.kind,
    pan: spatial.pan,
  }
}

const selectEventPlans = (
  candidates: ReadonlyArray<EndAudioEvent>,
  context: {
    readonly activeUntilSecs: MonotonicTimeSecs[]
    readonly availableSlots: number
    readonly lastPlayedAtSecs: Partial<Record<EndAudioEventKind, MonotonicTimeSecs>>
    readonly snapshot: EndAudioSnapshot
  },
): ReadonlyArray<EndAudioEventPlan> => {
  const selected: EndAudioEventPlan[] = []
  for (const event of candidates) {
    if (
      selected.length < context.availableSlots &&
      isOutsideCooldown(event.kind, context.snapshot.nowSecs, context.lastPlayedAtSecs)
    ) {
      const plan = eventPlan(event, context.snapshot)
      selected.push(plan)
      const endSecs = Math.min(Number.MAX_VALUE, context.snapshot.nowSecs + plan.fallback.durationSecs)
      context.activeUntilSecs.push(monotonicTimeSecs(endSecs))
      context.lastPlayedAtSecs[event.kind] = context.snapshot.nowSecs
    }
  }
  return selected
}

const planEndAudioAt = (
  snapshot: EndAudioSnapshot,
  previous: EndAudioState,
  nowSecs: MonotonicTimeSecs,
): EndAudioPlan => {
  const normalizedSnapshot = { ...snapshot, nowSecs }
  const maxSounds = boundedSoundLimit(snapshot.maxSimultaneousSounds)
  const loops = planEndLoops(snapshot.dimension, maxSounds)
  const activeUntilSecs = previous.activeUntilSecs.filter(
    (endsAtSecs) => Number.isFinite(endsAtSecs) && endsAtSecs > nowSecs,
  )
  const availableEventSlots = Math.max(0, maxSounds - loops.length - activeUntilSecs.length)
  const nextLastPlayedAtSecs: Partial<Record<EndAudioEventKind, MonotonicTimeSecs>> = {
    ...previous.lastPlayedAtSecs,
  }
  const candidates = eventCandidates(normalizedSnapshot, new Set(previous.recentEventIds))
  const events = selectEventPlans(candidates, {
    activeUntilSecs,
    availableSlots: availableEventSlots,
    lastPlayedAtSecs: nextLastPlayedAtSecs,
    snapshot: normalizedSnapshot,
  })

  return {
    events,
    loops,
    nextState: {
      activeUntilSecs,
      lastPlayedAtSecs: nextLastPlayedAtSecs,
      recentEventIds: rememberEventIds(previous.recentEventIds, snapshot.events),
    },
  }
}

export const planEndAudio = (
  snapshot: EndAudioSnapshot,
  previous: EndAudioState = INITIAL_END_AUDIO_STATE,
): Result.Result<EndAudioPlan, EndAudioClockFailure> => {
  const nowSecsOption = monotonicTimeSecs.option(snapshot.nowSecs)
  if (Option.isNone(nowSecsOption)) {
    return Result.fail({ _tag: 'EndAudioClockFailure' })
  }
  const nowSecs = monotonicTimeSecs(Math.max(0, nowSecsOption.value))
  return Result.succeed(planEndAudioAt(snapshot, previous, nowSecs))
}

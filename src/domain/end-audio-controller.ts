import type { AudioDurationSecs, AudioGain, AudioHandleId } from './audio-brands.js'
import {
  END_AMBIENCE_FADE_SECS,
  type EndAudioEventPlan,
  type EndAudioFallbackPlan,
  type EndAudioLoopKind,
  type EndAudioLoopPlan,
  type EndAudioSnapshot,
  type EndAudioState,
  INITIAL_END_AUDIO_STATE,
  planEndAudio,
} from './end-audio.js'
import {
  type MonotonicTimeSecs,
  MonotonicTimeSecs as monotonicTimeSecs,
} from '@nerima-games/mc-kernel/domain/quantities'

export type EndAudioHandle = { readonly id: AudioHandleId }

export type EndAudioPort = {
  readonly createLoop: (kind: EndAudioLoopKind, initialGain: AudioGain) => EndAudioHandle | null
  readonly setLoopGain: (handle: EndAudioHandle, gain: AudioGain, fadeSecs: AudioDurationSecs) => void
  readonly stopLoop: (handle: EndAudioHandle, fadeSecs: AudioDurationSecs) => void
  /** Return null when the renderer has no primary asset for this event. */
  readonly playEvent: (request: EndAudioEventPlan) => EndAudioHandle | null
  readonly playFallback: (request: EndAudioFallbackPlan) => EndAudioHandle | null
  readonly release: (handle: EndAudioHandle) => void
}

export type EndAudioController = {
  readonly update: (snapshot: EndAudioSnapshot) => void
  readonly dispose: () => void
  readonly state: () => EndAudioState
}

const releaseCompleted = (
  port: EndAudioPort,
  transient: Map<EndAudioHandle, MonotonicTimeSecs>,
  nowSecs: MonotonicTimeSecs,
): void => {
  for (const [handle, endsAtSecs] of transient) {
    if (endsAtSecs <= nowSecs) {
      port.release(handle)
      transient.delete(handle)
    }
  }
}

const stopUndesiredLoops = (
  port: EndAudioPort,
  loops: Map<EndAudioLoopKind, EndAudioHandle>,
  desired: ReadonlySet<EndAudioLoopKind>,
): void => {
  for (const [kind, handle] of loops) {
    if (!desired.has(kind)) {
      port.stopLoop(handle, END_AMBIENCE_FADE_SECS)
      port.release(handle)
      loops.delete(kind)
    }
  }
}

const upsertLoops = (
  port: EndAudioPort,
  loops: Map<EndAudioLoopKind, EndAudioHandle>,
  plans: ReadonlyArray<EndAudioLoopPlan>,
): void => {
  for (const loop of plans) {
    const existing = loops.get(loop.kind)
    if (existing) {
      port.setLoopGain(existing, loop.gain, loop.fadeSecs)
    } else {
      const handle = port.createLoop(loop.kind, loop.gain)
      if (handle) {
        loops.set(loop.kind, handle)
      }
    }
  }
}

const syncLoops = (
  port: EndAudioPort,
  loops: Map<EndAudioLoopKind, EndAudioHandle>,
  plans: ReadonlyArray<EndAudioLoopPlan>,
): void => {
  stopUndesiredLoops(port, loops, new Set(plans.map((loop) => loop.kind)))
  upsertLoops(port, loops, plans)
}

const playEvents = (
  playback: {
    readonly nowSecs: MonotonicTimeSecs
    readonly port: EndAudioPort
    readonly transient: Map<EndAudioHandle, MonotonicTimeSecs>
  },
  events: ReadonlyArray<EndAudioEventPlan>,
): void => {
  for (const event of events) {
    const primary = playback.port.playEvent(event)
    const handle = primary ?? playback.port.playFallback(event.fallback)
    if (handle) {
      const endSecs = Math.min(Number.MAX_VALUE, playback.nowSecs + event.fallback.durationSecs)
      playback.transient.set(handle, monotonicTimeSecs(endSecs))
    }
  }
}

const releaseAll = (
  port: EndAudioPort,
  loops: ReadonlyMap<EndAudioLoopKind, EndAudioHandle>,
  transient: ReadonlyMap<EndAudioHandle, MonotonicTimeSecs>,
): void => {
  for (const handle of loops.values()) {
    port.stopLoop(handle, END_AMBIENCE_FADE_SECS)
    port.release(handle)
  }
  for (const handle of transient.keys()) {
    port.release(handle)
  }
}

export const makeEndAudioController = (port: EndAudioPort): EndAudioController => {
  const loops = new Map<EndAudioLoopKind, EndAudioHandle>()
  const transient = new Map<EndAudioHandle, MonotonicTimeSecs>()
  let currentState = INITIAL_END_AUDIO_STATE
  let disposed = false

  const update = (snapshot: EndAudioSnapshot): void => {
    if (!disposed) {
      const { nowSecs } = snapshot
      releaseCompleted(port, transient, nowSecs)
      const plan = planEndAudio({ ...snapshot, nowSecs }, currentState)
      syncLoops(port, loops, plan.loops)
      playEvents({ nowSecs, port, transient }, plan.events)
      currentState = plan.nextState
    }
  }

  const dispose = (): void => {
    if (!disposed) {
      disposed = true
      releaseAll(port, loops, transient)
      loops.clear()
      transient.clear()
    }
  }

  return { dispose, state: () => currentState, update }
}

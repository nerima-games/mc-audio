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

export type EndAudioHandle = { readonly id: number }

export type EndAudioPort = {
  readonly createLoop: (kind: EndAudioLoopKind, initialGain: number) => EndAudioHandle | null
  readonly setLoopGain: (handle: EndAudioHandle, gain: number, fadeSecs: number) => void
  readonly stopLoop: (handle: EndAudioHandle, fadeSecs: number) => void
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

const ZERO_SECS = 0

const sanitizedTime = (value: number): number => {
  if (!Number.isFinite(value)) {
    return ZERO_SECS
  }
  return Math.max(ZERO_SECS, value)
}

const releaseCompleted = (
  port: EndAudioPort,
  transient: Map<EndAudioHandle, number>,
  nowSecs: number,
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
    readonly nowSecs: number
    readonly port: EndAudioPort
    readonly transient: Map<EndAudioHandle, number>
  },
  events: ReadonlyArray<EndAudioEventPlan>,
): void => {
  for (const event of events) {
    const primary = playback.port.playEvent(event)
    const handle = primary ?? playback.port.playFallback(event.fallback)
    if (handle) {
      playback.transient.set(handle, playback.nowSecs + event.fallback.durationSecs)
    }
  }
}

const releaseAll = (
  port: EndAudioPort,
  loops: ReadonlyMap<EndAudioLoopKind, EndAudioHandle>,
  transient: ReadonlyMap<EndAudioHandle, number>,
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
  const transient = new Map<EndAudioHandle, number>()
  let currentState = INITIAL_END_AUDIO_STATE
  let disposed = false

  const update = (snapshot: EndAudioSnapshot): void => {
    if (!disposed) {
      const nowSecs = sanitizedTime(snapshot.nowSecs)
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

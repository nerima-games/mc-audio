/**
 * The gain envelope, as arithmetic.
 *
 * ---------------------------------------------------------------------------
 * Why an envelope exists at all, when the reference had none
 * ---------------------------------------------------------------------------
 *
 * The reference implementation set a flat gain and then cut the oscillator off:
 *
 *     gainNode.gain.value = clamp01(request.gain)          // audio-engine.ts:59
 *     ...
 *     oscillator.stop(context.currentTime + duration)      // audio-engine.ts:104
 *
 * A sine wave stopped at an arbitrary instant is almost never at a zero
 * crossing, so the speaker cone is commanded from some non-zero displacement to
 * silence in one sample. That step is broadband — it is heard as a CLICK, on
 * every cue, forever. The same thing happens at the start, where the wave goes
 * from silence to full amplitude in one sample.
 *
 * This is worth spelling out because of how it fails: it never throws, no test
 * goes red, and `audio-engine.ts` has no tests at all (`docs/porting.md` §6).
 * It surfaces as "the game sounds cheap", which is not a bug report anybody
 * files. Nine cues at 70 ms each, every block break, for the life of the
 * project.
 *
 * A few milliseconds of ramp at each end removes it. That is all an envelope is
 * here — this is not a synthesiser and there is no sustain level, no decay
 * stage and no per-cue authoring. Adding those is a decision for whenever cues
 * stop being placeholder oscillators (`docs/responsibility.md` § assets: the
 * reference ships no audio files at all).
 *
 * ---------------------------------------------------------------------------
 * Why it is a pure function and not four lines inside the adapter
 * ---------------------------------------------------------------------------
 *
 * The same reason `domain/engine.ts` splits `planCue` out of
 * `makeSoundCueService`, and `domain/music.ts` splits `resolveMusicPlan` out of
 * its driver: a decision that is a value can be tested, printed, and compared
 * without the medium it will eventually be applied to. `gainAt` below is what
 * lets `apps/preview-soundboard` DRAW the envelope in a terminal, and what lets
 * `test/envelope.test.ts` assert the property that actually matters —
 * continuity at both ends — without a browser, a fake, or an ear.
 *
 * Every time in this file is in SECONDS on the audio device's own clock
 * (`AudioContextSurface.currentTime`), never a wall clock. `startSecs` is
 * passed in for the same reason `nowSecs` is passed into `makeSoundCueService`.
 */
import type { ToneRequest } from './backend-port'
import { clamp01 } from './volume'

/**
 * Rise time from silence to full gain.
 *
 * 5 ms is long enough to remove the step and short enough that a percussive
 * cue still reads as percussive — a block break with a 50 ms attack sounds like
 * a swell, which is a different and worse artefact than the click it replaced.
 */
export const ATTACK_SECS = 0.005

/**
 * Fall time from full gain back to silence.
 *
 * Longer than the attack, because the ear is far more forgiving of a slow
 * release than a slow attack, and because the release is where the reference's
 * click actually lived: `oscillator.stop()` at full amplitude.
 */
export const RELEASE_SECS = 0.02

/**
 * The shortest tone that can be asked for.
 *
 * Carried over from the reference's `Math.max(0.01, request.durationMs / 1000)`
 * (`audio-engine.ts:104`), which had no stated reason but is right: a request
 * for a zero-length or negative-length tone is a caller bug, and scheduling
 * `stop` at or before `start` makes a real oscillator emit nothing while still
 * occupying a node until garbage collection.
 */
export const MIN_DURATION_SECS = 0.01

/**
 * The lowest frequency an oscillator is driven at.
 *
 * Also the reference's (`Math.max(20, request.frequency)`,
 * `audio-engine.ts:52`). 20 Hz is the bottom of human hearing; below it the
 * oscillator is inaudible but still consumes a node, and a negative frequency
 * is accepted by Web Audio and produces the same tone as its absolute value,
 * which would make a caller's sign error silently work.
 */
export const MIN_FREQUENCY_HZ = 20

/**
 * One scheduled point on the gain curve.
 *
 * `kind` distinguishes the two `AudioParam` calls, and the distinction is not
 * cosmetic: `linearRampToValueAtTime` interpolates FROM THE PREVIOUS SCHEDULED
 * EVENT, so a ramp with no `setValueAtTime` before it starts from whatever the
 * parameter happened to hold — which for a reused node is the tail of the last
 * cue. The `set` points are what make the curve a function of this request
 * alone.
 */
export type EnvelopePoint = {
  readonly kind: 'set' | 'ramp'
  /** Absolute, on the audio device's clock. */
  readonly atSecs: number
  readonly gain: number
}

export type ToneEnvelope = {
  readonly points: ReadonlyArray<EnvelopePoint>
  /** Peak gain, after clamping. */
  readonly peakGain: number
  readonly startSecs: number
  /**
   * When to stop the oscillator, or `null` for a looping tone.
   *
   * `null` rather than `Infinity` because the two mean different things to the
   * adapter: `null` is "never call `stop`", and a music track that had `stop`
   * called at `Infinity` would be a scheduling error rather than a loop. The
   * reference had the same behaviour by accident — it skipped `stop` when
   * `loop` was set (`audio-engine.ts:103-105`), which is why the `durationMs`
   * it passed for BGM was dead code (`docs/public-api.md` §6).
   */
  readonly stopAtSecs: number | null
}

/**
 * The frequency an oscillator should actually be driven at.
 *
 * Separate from the envelope because it is a different clamp on a different
 * quantity, and because `apps/preview-soundboard` prints both the requested and
 * the driven frequency side by side — a cue whose two columns differ is a cue
 * whose definition is wrong, and that is visible at a glance rather than
 * audible never.
 */
export const drivenFrequency = (requested: number): number => {
  if (Number.isFinite(requested)) {
    return Math.max(MIN_FREQUENCY_HZ, requested)
  }
  return MIN_FREQUENCY_HZ
}

/** `startSecs` falls back to the start of the audio clock when the caller passes something non-finite. */
const NO_START_SECS = 0

const resolveStart = (startSecs: number): number => {
  if (Number.isFinite(startSecs)) {
    return startSecs
  }
  return NO_START_SECS
}

const resolveDurationSecs = (requestedDurationSecs: number): number => {
  if (Number.isFinite(requestedDurationSecs)) {
    return requestedDurationSecs
  }
  return MIN_DURATION_SECS
}

/**
 * Scale attack and release together when they do not fit inside `duration`,
 * rather than clipping whichever is checked second. `SUSTAIN_FRACTION` leaves
 * a sliver of sustain so that the four points never coincide.
 */
const SUSTAIN_FRACTION = 0.9
const FULL_SCALE = 1

const envelopeScale = (shaped: number, duration: number): number => {
  const fittable = duration * SUSTAIN_FRACTION
  if (shaped > fittable) {
    return fittable / shaped
  }
  return FULL_SCALE
}

/**
 * The gain curve for one tone.
 *
 * ---------------------------------------------------------------------------
 * The short-tone case, which is the one that bites
 * ---------------------------------------------------------------------------
 *
 * `CUE_DURATION_SECS` is 0.07 (`domain/engine.ts`) and attack plus release is
 * 0.025, so the usual cue has a comfortable sustain. But `MIN_DURATION_SECS` is
 * 0.01, which is SHORTER than the release alone. Scheduling a 20 ms release
 * inside a 10 ms tone would put the ramp's end after the oscillator has already
 * stopped — the ramp never completes, the parameter is cut off mid-slope, and
 * the click is back, now only for short cues and therefore only sometimes.
 *
 * So attack and release are scaled down together to fit, preserving their ratio
 * rather than truncating one of them. A tone too short to hold its peak becomes
 * a triangle with no sustain, which is the right shape for a click-length
 * sound, and never a shape whose points are out of order.
 */
export const toneEnvelope = (request: ToneRequest, startSecs: number): ToneEnvelope => {
  const peakGain = clamp01(request.gain)
  const start = resolveStart(startSecs)

  if (request.loop) {
    // A looping tone has an attack and then nothing: it is stopped by
    // `stopTone`, at which point the adapter schedules its own release. Giving
    // It a release here would fade the BGM out a fixed distance into the track
    // And leave it silent but still running.
    return {
      peakGain,
      points: [
        { atSecs: start, gain: 0, kind: 'set' },
        { atSecs: start + ATTACK_SECS, gain: peakGain, kind: 'ramp' },
      ],
      startSecs: start,
      stopAtSecs: null,
    }
  }

  const duration = Math.max(MIN_DURATION_SECS, resolveDurationSecs(request.durationSecs))
  const end = start + duration
  const scale = envelopeScale(ATTACK_SECS + RELEASE_SECS, duration)

  return {
    peakGain,
    points: [
      { atSecs: start, gain: 0, kind: 'set' },
      { atSecs: start + ATTACK_SECS * scale, gain: peakGain, kind: 'ramp' },
      { atSecs: end - RELEASE_SECS * scale, gain: peakGain, kind: 'set' },
      { atSecs: end, gain: 0, kind: 'ramp' },
    ],
    startSecs: start,
    stopAtSecs: end,
  }
}

/** The gain to report when there is nothing scheduled, or once every scheduled point is behind `atSecs`. */
const NO_POINTS_GAIN = 0
/** Loop step between adjacent points, and the offset from `length` to the last index. */
const ADJACENT_STEP = 1
/** Below this span, a `ramp`'s two points are effectively simultaneous — hold the later value instead of dividing by ~0. */
const MIN_SPAN = 0

type EnvelopeSegment = {
  readonly current: EnvelopePoint
  readonly previous: EnvelopePoint
}

/** The adjacent pair of points straddling `atSecs`, or `null` if `atSecs` is past every point. */
const findSegment = (
  points: ReadonlyArray<EnvelopePoint>,
  atSecs: number,
): EnvelopeSegment | null => {
  for (let index = ADJACENT_STEP; index < points.length; index += ADJACENT_STEP) {
    const previous = points[index - ADJACENT_STEP]
    const current = points[index]
    if (previous && current && atSecs <= current.atSecs) {
      return { current, previous }
    }
  }
  return null
}

/**
 * The gain within a segment at `atSecs`.
 *
 * A `set` point is a step: the value holds until the instant it is set, And
 * only a `ramp` interpolates. Treating both as ramps would draw a curve the
 * Browser does not produce.
 */
const interpolateSegment = (segment: EnvelopeSegment, atSecs: number): number => {
  const { current, previous } = segment
  if (current.kind === 'set') {
    return previous.gain
  }
  const span = current.atSecs - previous.atSecs
  if (span <= MIN_SPAN) {
    return current.gain
  }
  return previous.gain + ((current.gain - previous.gain) * (atSecs - previous.atSecs)) / span
}

/** The gain to report once `atSecs` is past every scheduled point: the last point's gain. */
const lastGain = (points: ReadonlyArray<EnvelopePoint>): number => {
  const last = points[points.length - ADJACENT_STEP]
  if (!last) {
    return NO_POINTS_GAIN
  }
  return last.gain
}

/**
 * The gain at an instant, by the same interpolation a browser performs.
 *
 * This is what makes the envelope INSPECTABLE rather than merely scheduled: the
 * preview samples it to draw a curve, and `test/envelope.test.ts` samples it to
 * assert that the curve starts at zero, ends at zero, and never jumps — the
 * three claims that together mean "no click", stated as arithmetic instead of
 * as a listening test.
 *
 * Before the first point and after the last, the value is the nearest point's
 * gain, which is what a real `AudioParam` holds too: automation does not
 * extrapolate.
 */
export const gainAt = (envelope: ToneEnvelope, atSecs: number): number => {
  const { points } = envelope
  const [first] = points
  if (!first) {
    return NO_POINTS_GAIN
  }
  if (atSecs <= first.atSecs) {
    return first.gain
  }

  const segment = findSegment(points, atSecs)
  if (!segment) {
    return lastGain(points)
  }
  return interpolateSegment(segment, atSecs)
}

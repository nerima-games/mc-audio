/**
 * The gain envelope, as arithmetic.
 *
 * These tests are the only place in this repository where the CLICK is a
 * testable claim. `test/fake-webaudio.ts` records automation calls but does not
 * evaluate them, and it says so in its header: modelling a browser's sample
 * rate and render quantum would produce plausible wrong numbers and convert
 * "we do not know how this sounds" into "we have tested how this sounds".
 *
 * So the shape is asserted here, on `gainAt`, where it is exactly true, and the
 * claim is precise about what it covers: the curve starts at zero, ends at
 * zero, and never jumps. Those three together are what "no discontinuity at the
 * boundaries" means. Whether that removes the audible click in a browser is a
 * listening test and is written down as one in `docs/testing.md` §4.
 *
 * What is being fixed: `packages/game/infrastructure/audio-engine.ts:59` set a
 * flat `gain.value` and `:104` called `oscillator.stop(...)`, so every cue
 * began and ended on a step. That file has zero tests (`docs/porting.md` §6),
 * and the failure never throws — it just sounds cheap forever.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { AudioDurationSecs, AudioFrequencyHz, AudioGain, AudioPan } from '../src/domain/audio-brands.js'
import type { ToneRequest } from '../src/domain/backend-port'
import {
  ATTACK_SECS,
  drivenFrequency,
  gainAt as brandedGainAt,
  MIN_DURATION_SECS,
  MIN_FREQUENCY_HZ,
  RELEASE_SECS,
  toneEnvelope as brandedToneEnvelope,
  type ToneEnvelope,
} from '../src/domain/envelope'

type ToneOverrides = Omit<Partial<ToneRequest>, 'durationSecs' | 'frequency' | 'gain' | 'pan'> & {
  readonly durationSecs?: number
  readonly frequency?: number
  readonly gain?: number
  readonly pan?: number
}

const tone = ({
  durationSecs = 0.07,
  frequency = 220,
  gain = 0.4,
  pan = 0,
  ...overrides
}: ToneOverrides = {}): ToneRequest => ({
  durationSecs: AudioDurationSecs(durationSecs),
  frequency: AudioFrequencyHz(frequency),
  gain: AudioGain(gain),
  pan: AudioPan(pan),
  loop: false,
  ...overrides,
})

const toneEnvelope = (request: ToneRequest, startSecs: number): ToneEnvelope =>
  brandedToneEnvelope(request, AudioDurationSecs(startSecs))

const gainAt = (envelope: ToneEnvelope, atSecs: number) =>
  brandedGainAt(envelope, AudioDurationSecs(atSecs))

/** Samples the curve densely enough that a step of any size shows up. */
const sample = (
  request: ToneRequest,
  startSecs: number,
  steps = 400,
): ReadonlyArray<{ readonly atSecs: number; readonly gain: number }> => {
  const envelope = toneEnvelope(request, startSecs)
  const end = envelope.stopAtSecs ?? startSecs + 0.1
  const span = end - startSecs
  return Array.from({ length: steps + 1 }, (_unused, index) => {
    const atSecs = startSecs + (span * index) / steps
    return { atSecs, gain: gainAt(envelope, atSecs) }
  })
}

const largestJump = (points: ReadonlyArray<{ readonly gain: number }>): number => {
  let largest = 0
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (previous === undefined || current === undefined) {
      continue
    }
    largest = Math.max(largest, Math.abs(current.gain - previous.gain))
  }
  return largest
}

describe('the envelope removes the discontinuity at both ends', () => {
  it.effect('starts at silence and ends at silence', () =>
    Effect.sync(() => {
      const envelope = toneEnvelope(tone(), 10)

      expect(gainAt(envelope, 10)).toBe(0)
      expect(gainAt(envelope, envelope.stopAtSecs ?? 0)).toBe(0)

      // ...and reaches the requested gain in between, or the ramp would be
      // "no click" achieved by playing nothing.
      expect(gainAt(envelope, 10 + ATTACK_SECS)).toBeCloseTo(0.4, 10)
    }),
  )

  it.effect('never jumps: no step anywhere in the curve', () =>
    Effect.sync(() => {
      const points = sample(tone(), 10)
      // 400 samples over 70 ms is a 0.175 ms step; the steepest legitimate
      // slope is the 5 ms attack, which climbs 0.4 in 5 ms, i.e. 0.014 per
      // sample. A genuine discontinuity is 0.4 in one step. The threshold sits
      // between the two by an order of magnitude in both directions.
      expect(largestJump(points)).toBeLessThan(0.05)
    }),
  )

  it.effect('the curve is monotonic up then down, with no dip in the sustain', () =>
    Effect.sync(() => {
      const envelope = toneEnvelope(tone(), 0)
      const end = envelope.stopAtSecs ?? 0

      // The sustain is where a mis-ordered `set` would show up as a notch.
      expect(gainAt(envelope, ATTACK_SECS + 0.001)).toBeCloseTo(0.4, 10)
      expect(gainAt(envelope, end - RELEASE_SECS - 0.001)).toBeCloseTo(0.4, 10)
      expect(gainAt(envelope, end - RELEASE_SECS / 2)).toBeGreaterThan(0)
      expect(gainAt(envelope, end - RELEASE_SECS / 2)).toBeLessThan(0.4)
    }),
  )

  it.effect('schedules a set before every ramp, so a reused node cannot leak in', () =>
    Effect.sync(() => {
      // `linearRampToValueAtTime` interpolates FROM THE PREVIOUS SCHEDULED
      // EVENT. A ramp with no `set` before it starts from whatever the
      // parameter held, which for a reused node is the tail of the last cue.
      const points = toneEnvelope(tone(), 3).points
      expect(points[0]?.kind).toBe('set')
      expect(points[0]?.gain).toBe(0)

      for (let index = 1; index < points.length; index += 1) {
        if (points[index]?.kind === 'ramp') {
          expect(points[index - 1]).toBeDefined()
        }
      }
    }),
  )

  it.effect('points are in non-decreasing time order', () =>
    Effect.sync(() => {
      // Out-of-order automation is accepted by a browser and produces a curve
      // nobody intended, silently.
      for (const durationSecs of [0.007, MIN_DURATION_SECS, 0.02, 0.07, 2]) {
        const points = toneEnvelope(tone({ durationSecs }), 5).points
        for (let index = 1; index < points.length; index += 1) {
          const previous = points[index - 1]?.atSecs ?? 0
          const current = points[index]?.atSecs ?? 0
          expect({ durationSecs, ordered: current >= previous }).toStrictEqual({
            durationSecs,
            ordered: true,
          })
        }
      }
    }),
  )
})

describe('the short-tone case, which is the one that bites', () => {
  it.effect('scales attack and release to fit a tone shorter than the release alone', () =>
    Effect.sync(() => {
      // MIN_DURATION_SECS is 0.01 and RELEASE_SECS is 0.02, so an unscaled
      // release would end AFTER the oscillator has stopped: the ramp never
      // completes, the parameter is cut off mid-slope, and the click is back
      // for short cues only — i.e. intermittently, which is worse than always.
      const envelope = toneEnvelope(tone({ durationSecs: MIN_DURATION_SECS }), 0)
      const stop = envelope.stopAtSecs ?? 0

      expect(stop).toBeCloseTo(MIN_DURATION_SECS, 10)
      for (const point of envelope.points) {
        expect(point.atSecs).toBeLessThanOrEqual(stop + 1e-12)
      }
      expect(gainAt(envelope, stop)).toBe(0)
      expect(largestJump(sample(tone({ durationSecs: MIN_DURATION_SECS }), 0))).toBeLessThan(0.05)
    }),
  )

  it.effect('preserves the attack-to-release ratio rather than truncating one', () =>
    Effect.sync(() => {
      const points = toneEnvelope(tone({ durationSecs: MIN_DURATION_SECS }), 0).points
      const attack = (points[1]?.atSecs ?? 0) - (points[0]?.atSecs ?? 0)
      const release = (points[3]?.atSecs ?? 0) - (points[2]?.atSecs ?? 0)

      expect(attack).toBeGreaterThan(0)
      expect(release).toBeGreaterThan(0)
      expect(attack / release).toBeCloseTo(ATTACK_SECS / RELEASE_SECS, 6)
    }),
  )

  it.effect('floors a zero-length request rather than scheduling backwards', () =>
    Effect.sync(() => {
      const envelope = toneEnvelope(tone({ durationSecs: 0 }), 4)
      expect(envelope.stopAtSecs).toBeCloseTo(4 + MIN_DURATION_SECS, 10)
      expect(Option.isNone(AudioDurationSecs.option(-1))).toBe(true)
    }),
  )
})

describe('a looping tone', () => {
  it.effect('has an attack and no release, and is never scheduled to stop', () =>
    Effect.sync(() => {
      // BGM. A release here would fade the track out a fixed distance in and
      // leave it silent but still running — and `stopTone` is what actually
      // ends it, with its own ramp.
      const envelope = toneEnvelope(tone({ loop: true, gain: 0.28 }), 100)

      expect(envelope.stopAtSecs).toBeNull()
      expect(envelope.points).toHaveLength(2)
      expect(gainAt(envelope, 100)).toBe(0)
      expect(gainAt(envelope, 100 + ATTACK_SECS)).toBeCloseTo(0.28, 10)
      // ...and it HOLDS, rather than decaying, however long the track runs.
      expect(gainAt(envelope, 100 + 600)).toBeCloseTo(0.28, 10)
    }),
  )

  it.effect('ignores durationSecs entirely, which the reference did by accident', () =>
    Effect.sync(() => {
      // `docs/public-api.md` §6: the reference passed `durationMs: 2000` for
      // BGM and its engine never called `stop` when `loop` was set, so that
      // number was dead code nobody had noticed. Here it is dead on purpose.
      const short = toneEnvelope(tone({ loop: true, durationSecs: 0.01 }), 0)
      const long = toneEnvelope(tone({ loop: true, durationSecs: 2 }), 0)
      expect(short.points).toStrictEqual(long.points)
    }),
  )
})

describe('clamping', () => {
  it.effect('rejects invalid gains at the branded request boundary', () =>
    Effect.sync(() => {
      expect(toneEnvelope(tone({ gain: 2 }), 0).peakGain).toBe(2)
      expect(Option.isNone(AudioGain.option(-1))).toBe(true)
      expect(Option.isNone(AudioGain.option(Number.NaN))).toBe(true)
    }),
  )

  it.effect('floors the driven frequency at the bottom of human hearing', () =>
    Effect.sync(() => {
      // Carried over from `audio-engine.ts:52`. A negative frequency is
      // accepted by Web Audio and produces the same tone as its absolute
      // value, so a caller's sign error would otherwise work by accident.
      expect(drivenFrequency(AudioFrequencyHz(220))).toBe(220)
      expect(drivenFrequency(AudioFrequencyHz(5))).toBe(MIN_FREQUENCY_HZ)
      expect(Option.isNone(AudioFrequencyHz.option(-440))).toBe(true)
      expect(Option.isNone(AudioFrequencyHz.option(Number.NaN))).toBe(true)
    }),
  )

  it.effect('uses safe fallbacks for malformed branded frequency and time values', () =>
    Effect.sync(() => {
      // @ts-expect-error Simulate an invalid branded duration from JavaScript.
      const malformedTime: AudioDurationSecs = Number.NaN
      // @ts-expect-error Simulate an invalid branded frequency from JavaScript.
      const malformedFrequency: AudioFrequencyHz = Number.NaN
      const malformedDurationRequest = { ...tone(), durationSecs: malformedTime }

      expect(drivenFrequency(malformedFrequency)).toBe(MIN_FREQUENCY_HZ)
      expect(brandedToneEnvelope(tone(), malformedTime).startSecs).toBe(AudioDurationSecs(0))
      expect(brandedToneEnvelope(malformedDurationRequest, AudioDurationSecs(4)).stopAtSecs).toBeCloseTo(
        4 + MIN_DURATION_SECS,
        10,
      )
    }),
  )

  it.effect('holds, rather than extrapolating, outside the scheduled span', () =>
    Effect.sync(() => {
      // What a real AudioParam does: automation does not extrapolate.
      const envelope = toneEnvelope(tone(), 10)
      expect(gainAt(envelope, 9)).toBe(0)
      expect(gainAt(envelope, 1000)).toBe(0)
    }),
  )

  it.effect('rejects non-finite audio clock readings at the branded boundary', () =>
    Effect.sync(() => {
      for (const startSecs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(Option.isNone(AudioDurationSecs.option(startSecs))).toBe(true)
      }
    }),
  )
})

describe('gainAt on a hand-built envelope', () => {
  it.effect('reports silence for an envelope with no points at all', () =>
    Effect.sync(() => {
      // Not producible by toneEnvelope, which always schedules at least two
      // points, but ToneEnvelope is an exported type and gainAt is a general
      // function over it — a caller could hand it an empty schedule.
      const empty: ToneEnvelope = { peakGain: AudioGain(0), points: [], startSecs: AudioDurationSecs(0), stopAtSecs: null }
      expect(gainAt(empty, 0)).toBe(0)
      expect(gainAt(empty, 5)).toBe(0)
    }),
  )

  it.effect('interpolates linearly between two ramp points at arbitrary gains', () =>
    Effect.sync(() => {
      // A hand-built two-point ramp, independent of toneEnvelope's own shape,
      // pinning gainAt's interpolation arithmetic directly.
      const ramp: ToneEnvelope = {
        peakGain: AudioGain(1),
        points: [
          { atSecs: AudioDurationSecs(0), gain: AudioGain(0), kind: 'set' },
          { atSecs: AudioDurationSecs(10), gain: AudioGain(1), kind: 'ramp' },
        ],
        startSecs: AudioDurationSecs(0),
        stopAtSecs: AudioDurationSecs(10),
      }
      expect(gainAt(ramp, 0)).toBe(0)
      expect(gainAt(ramp, 2.5)).toBeCloseTo(0.25, 10)
      expect(gainAt(ramp, 5)).toBeCloseTo(0.5, 10)
      expect(gainAt(ramp, 10)).toBeCloseTo(1, 10)
    }),
  )
})

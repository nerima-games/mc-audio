/**
 * The WebAudio adapter.
 *
 * ---------------------------------------------------------------------------
 * These tests did not exist anywhere, and could not have
 * ---------------------------------------------------------------------------
 *
 * `docs/design-notes.md` DN-6 lists four regression tests to write when the
 * adapter lands and ends with 「**参照実装にはこの 4 つとも存在しない。**」.
 * `docs/porting.md` §6 says why: `audio-engine.ts` (163 LOC) and
 * `audio-context-helpers.ts` (36 LOC) have ZERO tests between them, and nothing
 * in that entire repository ever constructs an `AudioContext`.
 *
 * That was not laziness. The reference's guard read a GLOBAL —
 * `typeof AudioContext === 'undefined'` — and no Node test can make that
 * expression false. The code was untestable by construction, so the branch that
 * every player hits on their first visit went three years unverified
 * (`docs/design-notes.md` DN-1, gates 2 and 3).
 *
 * `domain/webaudio-adapter.ts` takes the global as an argument. That one change
 * is what makes this file possible, and everything below is downstream of it.
 *
 * ---------------------------------------------------------------------------
 * What these tests do NOT claim
 * ---------------------------------------------------------------------------
 *
 * Not one of them says a player heard anything. `test/fake-webaudio.ts` makes
 * no sound and models no audio timing, and its header spells out the whole list
 * of what stays a browser question. These tests say the adapter built the graph
 * it meant to, scheduled the automation it meant to, and reported the right
 * availability when it did not.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import { AudioBackendPort, type ToneRequest } from '../src/domain/backend-port'
import { CaptionStream, type CaptionEvent } from '../src/domain/caption'
import { makeSoundCueService } from '../src/domain/engine'
import { ATTACK_SECS, RELEASE_SECS } from '../src/domain/envelope'
import { DEFAULT_VOLUME_SETTINGS } from '../src/domain/volume'
import {
  availabilityForState,
  DEFAULT_TONE_WAVE,
  makeWebAudioBackend,
  webAudioBackendLayer,
} from '../src/domain/webaudio-adapter'
import { makeFakeWebAudio, type FakeWebAudioOptions } from './fake-webaudio'

const CUE: ToneRequest = {
  frequency: 220,
  durationSecs: 0.07,
  gain: 0.4,
  pan: -0.5,
  loop: false,
}

const withFake = (options: FakeWebAudioOptions = {}) => {
  const fake = makeFakeWebAudio(options)
  return { fake, backend: makeWebAudioBackend({ global: fake.global }) }
}

// ---------------------------------------------------------------------------
// DN-6, row by row. These four are the ones the reference does not have.
// ---------------------------------------------------------------------------

describe('DN-6 — the AudioContext is created under a guard', () => {
  it.effect(
    "acquiring an AudioContext in an environment without one yields 'unavailable', not a failure",
    () =>
      Effect.gen(function* () {
        // Node, SSR, a browser without Web Audio. The reference returned
        // `Option.none()` here too and that part was right; what it could not
        // do was let anybody TEST it.
        const { fake, backend } = withFake({ present: false })
        const audio = yield* backend

        expect(yield* audio.availability).toBe('unavailable')
        expect(fake.constructorCalls()).toBe(0)

        // ...and it stays a value all the way through. No throw, no defect.
        const handle = yield* audio.playTone(CUE)
        expect(handle.id).toBe(1)
        expect(yield* audio.unlock).toBe('unavailable')

        const report = yield* audio.report
        expect(report.constructorName).toBeNull()
        expect(report.contextState).toBeNull()
        expect(report.refusedTones).toBe(1)
      }),
  )

  it.effect("a context that throws on construction yields 'unavailable', not a defect", () =>
    Effect.gen(function* () {
      // Chrome caps hardware contexts at six per page and throws on the
      // seventh. `Effect.try` + catch, exactly as the reference did
      // (`acquireAudioContext`) — that shape was worth porting.
      const { fake, backend } = withFake({ constructionThrows: true })
      const audio = yield* backend

      expect(yield* audio.availability).toBe('unavailable')
      expect(fake.constructorCalls()).toBeGreaterThan(0)
      expect(fake.contexts()).toHaveLength(0)

      const report = yield* audio.report
      expect(report.contextAttempted).toBe(true)
      expect(report.availability).toBe('unavailable')
    }),
  )

  it.effect('the context is created lazily, at the first cue, not at layer construction', () =>
    Effect.gen(function* () {
      // Building the Layer must not touch the audio hardware. A page that
      // wires mc-audio into its Layer graph at start-up should not thereby ask
      // the device for anything.
      const fake = makeFakeWebAudio()
      const layer = webAudioBackendLayer({ global: fake.global })

      // The Layer exists as a value and nothing has been constructed.
      expect(fake.constructorCalls()).toBe(0)

      yield* Effect.gen(function* () {
        const backend = yield* AudioBackendPort
        expect(fake.constructorCalls()).toBe(0)
        yield* backend.playTone(CUE)
        expect(fake.constructorCalls()).toBe(1)
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('captions still fire when the context is unavailable', () =>
    Effect.gen(function* () {
      // DN-1 gate 3, now against the REAL adapter rather than a recording
      // stand-in. This is the row `docs/design-notes.md` marks as the point of
      // writing the adapter at all: the invariant was pinned for a fake
      // backend, and this is the first time it is pinned for the code that
      // will actually run in a browser.
      const { backend } = withFake({ present: false })
      const audio = yield* backend
      const log = yield* Ref.make<ReadonlyArray<CaptionEvent>>([])

      const service = yield* makeSoundCueService({
        context: Effect.map(audio.availability, (availability) => ({
          settings: DEFAULT_VOLUME_SETTINGS,
          enabled: true,
          availability,
          listener: { x: 0, y: 64, z: 0 },
        })),
        nowSecs: Effect.succeed(1),
      }).pipe(
        Effect.provide(
          Layer.merge(
            Layer.succeed(AudioBackendPort, audio),
            Layer.succeed(CaptionStream, {
              emit: (event) => Ref.update(log, (current) => [...current, event]),
            }),
          ),
        ),
      )

      yield* service.play('blockBreak', { position: { x: 3, y: 64, z: 0 } })

      const captions = yield* Ref.get(log)
      expect(captions).toHaveLength(1)
      expect(captions[0]?.reason).toBe('unavailable')
      expect((yield* audio.report).refusedTones).toBe(0)
    }),
  )
})

// ---------------------------------------------------------------------------
// The unlock, which the reference has no mechanism for at all
// ---------------------------------------------------------------------------

describe("the user-gesture unlock: 'locked' before, 'ready' after", () => {
  it.effect("reports 'locked' before a gesture and 'ready' after", () =>
    Effect.gen(function* () {
      // `docs/testing.md` §4-2 makes this a completion criterion, and
      // `docs/public-api.md` §7 lists it as new design rather than porting: a
      // grep of the reference for `webkitAudioContext|autoplay|userGesture|
      // unlock` returns nothing.
      const { backend } = withFake({ resumePolicy: 'allow' })
      const audio = yield* backend

      expect(yield* audio.availability).toBe('locked')
      expect(yield* audio.unlock).toBe('ready')
      expect(yield* audio.availability).toBe('ready')
    }),
  )

  it.effect('a rejected resume() leaves it locked and counts the refusal, rather than throwing', () =>
    Effect.gen(function* () {
      // Chrome with no user activation. The reference did
      // `Effect.catchAllCause(() => Effect.void)` here and then built the
      // oscillator anyway.
      const { backend } = withFake({ resumePolicy: 'reject' })
      const audio = yield* backend

      expect(yield* audio.unlock).toBe('locked')

      const report = yield* audio.report
      expect(report.unlockAttempts).toBe(1)
      expect(report.unlockRefusals).toBe(1)
      expect(report.availability).toBe('locked')
    }),
  )

  it.effect('a RESOLVED resume() that left the context suspended is still locked', () =>
    Effect.gen(function* () {
      // Safari does this, and it is the one that fools code trusting the
      // promise. `unlock` re-reads `state` afterwards for exactly this case;
      // an implementation that returned 'ready' on resolution would be green
      // against `resumePolicy: 'reject'` and wrong on the platform where audio
      // is most fragile.
      const { backend } = withFake({ resumePolicy: 'refuse' })
      const audio = yield* backend

      expect(yield* audio.unlock).toBe('locked')
      expect((yield* audio.report).unlockRefusals).toBe(1)
    }),
  )

  it.effect("an interrupted context is 'locked', not 'ready' — the iOS phone call", () =>
    Effect.gen(function* () {
      // `'interrupted'` is the fourth AudioContextState, found by compiling
      // `test/fixtures/webaudio-surface.ts` against the real lib.dom.d.ts. An
      // adapter that had never heard of it treats "not suspended" as running
      // and labels its captions `audible` for sound nobody can hear.
      const { fake, backend } = withFake()
      const audio = yield* backend

      yield* audio.unlock
      expect(yield* audio.availability).toBe('ready')

      fake.context()?.interrupt()
      expect(yield* audio.availability).toBe('locked')

      // ...and a cue arriving mid-call is refused rather than built.
      yield* audio.playTone(CUE)
      expect((yield* audio.report).refusedTones).toBe(1)

      fake.context()?.endInterruption()
      expect(yield* audio.availability).toBe('ready')

      // Both edges were observed, which polling `state` between cues could not
      // have done: an interruption that begins and ends between two cues leaves
      // no other trace.
      expect((yield* audio.report).spontaneousStateChanges).toBeGreaterThanOrEqual(2)
    }),
  )

  it.effect("a closed context is 'unavailable', not 'locked' — no gesture revives it", () =>
    Effect.gen(function* () {
      // The distinction `locked` exists to draw. Reporting `locked` here would
      // leave a UI showing a "click to enable sound" button that can never work.
      const { backend } = withFake()
      const audio = yield* backend

      yield* audio.unlock
      yield* audio.close

      expect(yield* audio.availability).toBe('unavailable')
    }),
  )

  it.effect('maps every state, so a new one cannot be silently defaulted to ready', () =>
    Effect.sync(() => {
      expect(availabilityForState('running')).toBe('ready')
      expect(availabilityForState('suspended')).toBe('locked')
      expect(availabilityForState('interrupted')).toBe('locked')
      expect(availabilityForState('closed')).toBe('unavailable')
    }),
  )
})

// ---------------------------------------------------------------------------
// The guard's actual job: refuse without building
// ---------------------------------------------------------------------------

describe('a refused cue builds no nodes and is discarded, never queued', () => {
  it.effect('builds NOTHING while locked — the reference built the whole graph', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake({ resumePolicy: 'reject' })
      const audio = yield* backend

      yield* audio.playTone(CUE)
      yield* audio.playTone(CUE)

      const context = fake.context()
      // The master gain and its edge to destination exist — the context was
      // created and wired. What must NOT exist is an oscillator.
      expect(context?.log.created.filter((id) => id.startsWith('osc'))).toStrictEqual([])
      expect(context?.log.started).toStrictEqual([])
      expect((yield* audio.report).refusedTones).toBe(2)
    }),
  )

  it.effect('does not replay refused cues after unlocking', () =>
    Effect.gen(function* () {
      // The policy `domain/webaudio-adapter.ts` argues for: a block-break sound
      // played at unlock time is about a block that is no longer there. The
      // information already went out as a caption with reason 'gate-blocked'.
      const { fake, backend } = withFake({ resumePolicy: 'allow' })
      const audio = yield* backend

      yield* audio.playTone(CUE)
      yield* audio.playTone(CUE)
      expect((yield* audio.report).refusedTones).toBe(2)

      yield* audio.unlock

      // Unlocking creates no oscillators for the two that were dropped.
      expect(fake.context()?.log.created.filter((id) => id.startsWith('osc'))).toStrictEqual([])

      yield* audio.playTone(CUE)
      expect(fake.context()?.log.created.filter((id) => id.startsWith('osc'))).toStrictEqual([
        'osc#2',
      ])
      // The counter is not reset: two cues really were missed, and that stays
      // reportable.
      expect((yield* audio.report).refusedTones).toBe(2)
    }),
  )

  it.effect('still allocates a handle when refused, which is a documented trap', () =>
    Effect.gen(function* () {
      // `docs/public-api.md` §3 keeps this shape on purpose so that every
      // backend behaves the same: "I got a handle" never means "it played"
      // anywhere in this repository. Branch on `availability`.
      const { backend } = withFake({ resumePolicy: 'reject' })
      const audio = yield* backend

      expect((yield* audio.playTone(CUE)).id).toBe(1)
      expect((yield* audio.playTone(CUE)).id).toBe(2)
      // What is different here: the refusal is COUNTED, so the trap is at
      // least observable from outside.
      expect((yield* audio.report).refusedTones).toBe(2)
    }),
  )
})

// ---------------------------------------------------------------------------
// The graph, and the automation on it
// ---------------------------------------------------------------------------

describe('the node graph the adapter builds', () => {
  it.effect('wires oscillator into gain into panner into master into destination', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.playTone(CUE)

      const context = fake.context()
      expect(context?.log.created).toStrictEqual(['gain#1', 'osc#2', 'gain#3', 'panner#4'])
      expect(context?.log.edges).toStrictEqual([
        { from: 'gain#1', to: 'destination' },
        { from: 'osc#2', to: 'gain#3' },
        { from: 'gain#3', to: 'panner#4' },
        { from: 'panner#4', to: 'gain#1' },
      ])
    }),
  )

  it.effect('falls back to a MONO graph when createStereoPanner is absent', () =>
    Effect.gen(function* () {
      // Safari before 14.1. Connecting to master and leaving `pan` unapplied
      // would make every spatialised cue sound centred, which reads as
      // "spatialisation is broken" rather than "this browser cannot pan".
      const { fake, backend } = withFake({ stereo: false })
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.playTone(CUE)

      const context = fake.context()
      expect(context?.log.created.some((id) => id.startsWith('panner'))).toBe(false)
      expect(context?.log.edges).toStrictEqual([
        { from: 'gain#1', to: 'destination' },
        { from: 'osc#2', to: 'gain#3' },
        { from: 'gain#3', to: 'gain#1' },
      ])
      // ...and the report SAYS so, which is the part that makes it a fallback
      // rather than a silent degradation.
      expect((yield* audio.report).stereo).toBe(false)
    }),
  )

  it.effect('applies pan on the panner, in the [-1, 1] the domain already computed', () =>
    Effect.gen(function* () {
      // The reference used a 3D PannerNode with `positionX = pan * 10`
      // (`audio-engine.ts:74-77`), an unexplained fabricated coordinate that
      // does not equal the stereo pan it stood in for.
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.playTone(CUE)

      const panCalls = fake.context()?.log.params.filter((call) => call.param === 'pan')
      expect(panCalls).toStrictEqual([
        { node: 'panner#4', param: 'pan', kind: 'assign', value: -0.5, atSecs: 0 },
      ])
    }),
  )

  it.effect('schedules the envelope on the gain, not a flat value', () =>
    Effect.gen(function* () {
      // The whole reason `domain/envelope.ts` exists. A flat `gain.value` plus
      // `oscillator.stop()` is `audio-engine.ts:59` and `:104`, and it clicks
      // at both ends.
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.playTone(CUE)

      const context = fake.context()
      const cueGain = context?.log.params.filter(
        (call) => call.param === 'gain' && call.node === 'gain#3',
      )

      expect(cueGain).toStrictEqual([
        { node: 'gain#3', param: 'gain', kind: 'set', value: 0, atSecs: 0 },
        { node: 'gain#3', param: 'gain', kind: 'ramp', value: 0.4, atSecs: ATTACK_SECS },
        { node: 'gain#3', param: 'gain', kind: 'set', value: 0.4, atSecs: 0.07 - RELEASE_SECS },
        { node: 'gain#3', param: 'gain', kind: 'ramp', value: 0, atSecs: 0.07 },
      ])
    }),
  )

  it.effect('starts and stops against the audio clock, never a wall clock', () =>
    Effect.gen(function* () {
      // `pnpm check:deps` bans `Date.now()`, `new Date()` and
      // `performance.now()`, and the `mc-kernel-allow-time-source` escape hatch
      // is NOT taken anywhere in this repository. Scheduling rides
      // `context.currentTime`, which is the device's own monotonic clock —
      // anticipated by `docs/public-api.md` §7 and true.
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock

      fake.context()?.advance(5)
      yield* audio.playTone(CUE)

      expect(fake.context()?.log.started).toStrictEqual([{ node: 'osc#2', atSecs: 5 }])
      expect(fake.context()?.log.stopped).toStrictEqual([{ node: 'osc#2', atSecs: 5.07 }])
    }),
  )

  it.effect('sets the waveform, and it is the one constant this adapter has to pick', () =>
    Effect.gen(function* () {
      // `ToneRequest` has no `wave` field, so the reference's per-track
      // waveforms (day sine / night triangle / cave sawtooth) are unreachable.
      // Pinned so that the loss is a visible line rather than a silent default.
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.playTone(CUE)

      expect(fake.context()?.oscillators[0]?.type).toBe(DEFAULT_TONE_WAVE)
      expect(DEFAULT_TONE_WAVE).toBe('sine')
    }),
  )

  it.effect('releases every node when a tone ends, so nothing leaks', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.playTone(CUE)

      expect((yield* audio.report).activeTones).toBe(1)

      fake.context()?.advance(1)

      expect(fake.context()?.log.disconnected).toStrictEqual(['osc#2', 'gain#3', 'panner#4'])
      expect((yield* audio.report).activeTones).toBe(0)
    }),
  )
})

// ---------------------------------------------------------------------------
// Master gain: applied ONCE, by one node
// ---------------------------------------------------------------------------

describe('the master gain node', () => {
  it.effect('is the only place master turns into a number on the graph', () =>
    Effect.gen(function* () {
      // DN-2. The per-cue gain must not carry master, or a setting of 0.5
      // sounds like 0.25. `test/volume.test.ts` pins the arithmetic; this pins
      // that the adapter honours it — master reaches exactly one node.
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.setMasterGain(0.5)
      yield* audio.playTone(CUE)

      const context = fake.context()
      const masterWrites = context?.log.params.filter((call) => call.node === 'gain#1')
      expect(masterWrites).toStrictEqual([
        { node: 'gain#1', param: 'gain', kind: 'assign', value: 0.8, atSecs: 0 },
        { node: 'gain#1', param: 'gain', kind: 'assign', value: 0.5, atSecs: 0 },
      ])

      // ...and the cue's own peak is still its own, untouched by master.
      const cuePeak = context?.log.params.find(
        (call) => call.node === 'gain#3' && call.kind === 'ramp' && call.value > 0,
      )
      expect(cuePeak?.value).toBe(0.4)
    }),
  )

  it.effect('remembers a gain set before the context existed', () =>
    Effect.gen(function* () {
      // Settings load before the first cue. A master node that started at the
      // default and was corrected on the next settings change would play the
      // first cue at the wrong volume.
      const { fake, backend } = withFake()
      const audio = yield* backend

      yield* audio.setMasterGain(0.25)
      expect(fake.constructorCalls()).toBe(0)

      yield* audio.unlock

      expect(fake.context()?.log.params).toStrictEqual([
        { node: 'gain#1', param: 'gain', kind: 'assign', value: 0.25, atSecs: 0 },
      ])
    }),
  )

  it.effect('clamps into [0, 1] rather than passing a caller error to the device', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.setMasterGain(4)
      yield* audio.setMasterGain(-2)

      const values = fake
        .context()
        ?.log.params.filter((call) => call.node === 'gain#1')
        .map((call) => call.value)
      expect(values).toStrictEqual([0.8, 1, 0])
    }),
  )
})

// ---------------------------------------------------------------------------
// Stopping, and the other browser
// ---------------------------------------------------------------------------

describe('stopping a tone', () => {
  it.effect('ramps down from where the tone actually is, rather than cutting', () =>
    Effect.gen(function* () {
      // `stopTone` is how BGM ends and how a looping cue is cancelled. A loop
      // cut mid-cycle at full amplitude is the loudest click this adapter could
      // produce — a sustained tone is at full gain by definition.
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock

      const handle = yield* audio.playTone({ ...CUE, loop: true, gain: 0.28 })
      fake.context()?.advance(3)
      yield* audio.stopTone(handle)

      const cueGain = fake
        .context()
        ?.log.params.filter((call) => call.node === 'gain#3')
        .slice(2)

      expect(cueGain).toStrictEqual([
        { node: 'gain#3', param: 'gain', kind: 'cancel', value: 0, atSecs: 3 },
        { node: 'gain#3', param: 'gain', kind: 'set', value: 0.28, atSecs: 3 },
        { node: 'gain#3', param: 'gain', kind: 'ramp', value: 0, atSecs: 3 + RELEASE_SECS },
      ])
      expect(fake.context()?.log.stopped).toStrictEqual([
        { node: 'osc#2', atSecs: 3 + RELEASE_SECS },
      ])
    }),
  )

  it.effect('cancels the tone\'s own scheduled release first, or two curves compete', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock

      const handle = yield* audio.playTone(CUE)
      fake.context()?.advance(0.01)
      yield* audio.stopTone(handle)

      const kinds = fake
        .context()
        ?.log.params.filter((call) => call.node === 'gain#3')
        .map((call) => call.kind)
      expect(kinds?.slice(4)).toStrictEqual(['cancel', 'set', 'ramp'])
    }),
  )

  it.effect('ramps from the ATTACK value when stopped mid-attack, not from the peak', () =>
    Effect.gen(function* () {
      // Ramping from the peak would be a step UP for a tone cancelled during
      // its attack: a cancel that makes the sound briefly louder.
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock

      const handle = yield* audio.playTone(CUE)
      fake.context()?.advance(ATTACK_SECS / 2)
      yield* audio.stopTone(handle)

      const set = fake
        .context()
        ?.log.params.filter((call) => call.node === 'gain#3' && call.kind === 'set')
        .at(-1)
      expect(set?.value).toBeCloseTo(0.2, 10)
    }),
  )

  it.effect('ignores an unknown handle rather than failing', () =>
    Effect.gen(function* () {
      const { backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.stopTone({ id: 999 })
      expect((yield* audio.report).activeTones).toBe(0)
    }),
  )
})

describe('Safari before 14.1', () => {
  it.effect('finds the prefixed constructor when the standard one is absent', () =>
    Effect.gen(function* () {
      // `docs/public-api.md` §7 lists this as NEW work: a grep of the entire
      // reference implementation for `webkitAudioContext` returns nothing, so
      // that browser had no audio at all and nobody noticed.
      const { fake, backend } = withFake({ prefixed: true })
      const audio = yield* backend

      expect(yield* audio.unlock).toBe('ready')
      expect((yield* audio.report).constructorName).toBe('webkitAudioContext')
      expect(fake.contexts()).toHaveLength(1)
    }),
  )

  it.effect('prefers the standard constructor when a browser has both', () =>
    Effect.gen(function* () {
      const { backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      expect((yield* audio.report).constructorName).toBe('AudioContext')
    }),
  )
})

describe('a context that is born broken', () => {
  it.effect("reports 'unavailable' when wiring the master gain throws", () =>
    Effect.gen(function* () {
      // Construction succeeding and the first node failing is a distinct
      // outcome from construction throwing, and both have to end as a value.
      const { backend } = withFake({ wiringThrows: true })
      const audio = yield* backend

      expect(yield* audio.availability).toBe('unavailable')
      expect((yield* audio.report).contextAttempted).toBe(true)
    }),
  )

  it.effect('retries construction on a later call rather than caching the failure', () =>
    Effect.gen(function* () {
      // Deliberate: a page whose first context failed because six were already
      // open can succeed later, once one has been closed. Caching "no" would
      // make that page permanently silent.
      const { fake, backend } = withFake({ constructionThrows: true })
      const audio = yield* backend

      yield* audio.availability
      yield* audio.availability
      expect(fake.constructorCalls()).toBe(2)
    }),
  )
})

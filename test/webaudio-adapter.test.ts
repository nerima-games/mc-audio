/* oxlint-disable func-names, id-length, max-statements, no-magic-numbers, no-ternary, prefer-destructuring, sort-imports -- Effect generator tests use framework callbacks, tuple coordinates, and exact audio timing/gain assertions whose literals are the specification. */
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
import { EpochMillis, FixedClockLayer, MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import { AudioBackendPort, type ToneRequest } from '../src/domain/backend-port'
import { type CaptionEvent, CaptionStream } from '../src/domain/caption'
import { makeSoundCueService } from '../src/domain/engine'
import { ATTACK_SECS, RELEASE_SECS, toneEnvelope } from '../src/domain/envelope'
import { DEFAULT_VOLUME_SETTINGS } from '../src/domain/volume'
import {
  DEFAULT_TONE_WAVE,
  availabilityForState,
  makeWebAudioBackend,
  webAudioBackendLayer,
} from '../src/domain/webaudio-adapter'
import { buildToneGraph } from '../src/domain/webaudio-tone-graph'
import { type FakeWebAudioOptions, makeFakeWebAudio } from './fake-webaudio'

const CUE: ToneRequest = {
  durationSecs: 0.07,
  frequency: 220,
  gain: 0.4,
  loop: false,
  pan: -0.5,
}

const withFake = (options: FakeWebAudioOptions = {}) => {
  const fake = makeFakeWebAudio(options)
  return { backend: makeWebAudioBackend({ global: fake.global }), fake }
}

describe('decoded sample playback', () => {
  it.effect('reports an empty preload when no sample manifest is configured', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({ global: fake.global })

      expect(yield* audio.preloadSamples()).toEqual({ cached: 0, failed: 0, loaded: 0, requested: 0 })
    }),
  )

  it.effect('loads URL and ArrayBuffer samples once, then plays the cached buffer', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio({ decodedDurationSecs: 0.25 })
      let urlLoads = 0
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        loadSampleData: async () => {
          urlLoads += 1
          return new ArrayBuffer(4)
        },
        sampleManifest: {
          'block.break': { kind: 'url', url: '/audio/block-break.ogg' },
          'player.hurt': { data: new ArrayBuffer(8), kind: 'array-buffer' },
        },
      })

      expect(yield* audio.preloadSamples()).toEqual({ cached: 0, failed: 0, loaded: 2, requested: 2 })
      expect(yield* audio.preloadSamples()).toEqual({ cached: 2, failed: 0, loaded: 0, requested: 2 })
      expect(urlLoads).toBe(1)
      expect(fake.context()?.decodedData).toHaveLength(2)

      yield* audio.unlock
      yield* audio.playTone({ ...CUE, soundId: 'block.break' })
      expect(fake.context()?.bufferSources[0]?.buffer?.duration).toBe(0.25)
      expect(fake.context()?.oscillators).toHaveLength(0)
    }),
  )

  it.effect('deduplicates concurrent loads of the same sample', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      let urlLoads = 0
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        loadSampleData: async () => {
          urlLoads += 1
          await Promise.resolve()
          return new ArrayBuffer(4)
        },
        sampleManifest: { step: { kind: 'url', url: '/audio/step.ogg' } },
      })

      yield* Effect.all([audio.preloadSamples(['step']), audio.preloadSamples(['step'])], {
        concurrency: 'unbounded',
      })
      expect(urlLoads).toBe(1)
      expect(fake.context()?.decodedData).toHaveLength(1)
    }),
  )

  it.effect('reports decode failure and retains oscillator fallback', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio({ decodeThrows: true })
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        sampleManifest: { missing: { data: new ArrayBuffer(4), kind: 'array-buffer' } },
      })

      expect(yield* audio.preloadSamples(['missing'])).toEqual({ cached: 0, failed: 1, loaded: 0, requested: 1 })
      yield* audio.unlock
      yield* audio.playTone({ ...CUE, soundId: 'missing' })
      expect(fake.context()?.bufferSources).toHaveLength(0)
      expect(fake.context()?.oscillators).toHaveLength(1)
    }),
  )

  it.effect('counts a requested id with no manifest entry as failed, not silently skipped', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        sampleManifest: { step: { data: new ArrayBuffer(4), kind: 'array-buffer' } },
      })

      expect(yield* audio.preloadSamples(['step', 'unknown-id'])).toEqual({
        cached: 0,
        failed: 1,
        loaded: 1,
        requested: 2,
      })
    }),
  )

  it.effect('fails a URL sample when no loadSampleData loader was configured', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        sampleManifest: { step: { kind: 'url', url: '/audio/step.ogg' } },
      })

      expect(yield* audio.preloadSamples(['step'])).toEqual({
        cached: 0,
        failed: 1,
        loaded: 0,
        requested: 1,
      })
      yield* audio.unlock
      yield* audio.playTone({ ...CUE, soundId: 'step' })
      // The load failed, so playback falls back to the synthesized oscillator
      // rather than a decoded buffer.
      expect(fake.context()?.bufferSources).toHaveLength(0)
      expect(fake.context()?.oscillators).toHaveLength(1)
    }),
  )

  it.effect('preloads marked stream sources once when the runtime is initialized', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      let preloadCalls = 0
      let resolvePreload: (() => void) | null = null
      const preloadFinished = new Promise<void>((resolve) => {
        resolvePreload = resolve
      })
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        preloadStream: () =>
          Effect.sync(() => {
            preloadCalls += 1
            resolvePreload?.()
            return true
          }),
        sampleManifest: {
          ambient: { kind: 'url', preload: true, stream: true, url: '/audio/ambient.ogg' },
          lazy: { kind: 'url', preload: false, stream: true, url: '/audio/lazy.ogg' },
        },
      })

      expect(yield* audio.availability).toBe('locked')
      yield* Effect.promise(() => preloadFinished)
      expect(preloadCalls).toBe(1)
      expect(yield* audio.availability).toBe('locked')
      expect(yield* audio.preloadSamples(['ambient'])).toEqual({
        cached: 1,
        failed: 0,
        loaded: 0,
        requested: 1,
      })
      expect(preloadCalls).toBe(1)
    }),
  )

  it.effect('falls back to decoded samples when stream preload fails', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        preloadStream: () => Effect.fail(new Error('stream preload failed')),
        sampleManifest: {
          music: { data: new ArrayBuffer(8), kind: 'array-buffer', stream: true },
        },
      })

      expect(yield* audio.preloadSamples(['music'])).toEqual({
        cached: 0,
        failed: 0,
        loaded: 1,
        requested: 1,
      })
      expect(fake.context()?.decodedData).toHaveLength(1)
    }),
  )

  it.effect('refuses streamed cues without an id or host stream factory', () =>
    Effect.gen(function* () {
      const noIdFake = makeFakeWebAudio()
      const noIdAudio = yield* makeWebAudioBackend({ global: noIdFake.global })
      yield* noIdAudio.unlock
      yield* noIdAudio.playTone({ ...CUE, stream: true })
      expect((yield* noIdAudio.report).refusedTones).toBe(1)

      const noFactoryFake = makeFakeWebAudio()
      const noFactoryAudio = yield* makeWebAudioBackend({
        global: noFactoryFake.global,
        sampleManifest: { stream: { kind: 'url', stream: true, url: '/audio/stream.ogg' } },
      })
      yield* noFactoryAudio.unlock
      yield* noFactoryAudio.playTone({ ...CUE, soundId: 'stream', stream: true })
      expect((yield* noFactoryAudio.report).refusedTones).toBe(1)
    }),
  )

  it.effect('refuses streamed cues without a source and decodes a manifest fallback', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      let sourceCalls = 0
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        createStreamSource: () => {
          sourceCalls += 1
          return fake.contexts()[0]?.createOscillator() ?? null
        },
        sampleManifest: {
          decoded: { data: new ArrayBuffer(4), kind: 'array-buffer' },
        },
      })

      yield* audio.unlock
      yield* audio.playTone({ ...CUE, soundId: 'unknown', stream: true })
      yield* audio.playTone({ ...CUE, soundId: 'decoded', stream: true })

      expect(sourceCalls).toBe(0)
      expect((yield* audio.report).refusedTones).toBe(1)
      expect(fake.context()?.bufferSources).toHaveLength(1)
    }),
  )

  it.effect('swallows a host stream factory failure and refuses the cue', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        createStreamSource: () => {
          throw new Error('stream factory failed')
        },
        sampleManifest: {
          stream: { kind: 'url', stream: true, url: '/audio/stream.ogg' },
        },
      })

      yield* audio.unlock
      yield* audio.playTone({ ...CUE, soundId: 'stream', stream: true })

      expect((yield* audio.report).refusedTones).toBe(1)
    }),
  )

  it.effect('plays music through the decoded sample path', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio({ decodedDurationSecs: 0.2 })
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        sampleManifest: {
          music: { data: new ArrayBuffer(8), kind: 'array-buffer', stream: true },
        },
      })

      yield* audio.unlock
      const handle = yield* audio.playMusic({ gain: 0.7, playbackRate: 1, soundId: 'music', stream: true })

      expect(fake.context()?.bufferSources).toHaveLength(1)
      expect(fake.context()?.oscillators).toHaveLength(0)
      expect(fake.context()?.log.stopped).toHaveLength(0)
      expect(yield* audio.isToneActive(handle)).toBe(true)
    }),
  )

  it.effect('updates and queries active tone gain without failing for an unknown handle', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({ global: fake.global })

      yield* audio.unlock
      const handle = yield* audio.playTone(CUE)
      expect(yield* audio.isToneActive(handle)).toBe(true)
      yield* audio.setToneGain(handle, 0.25)
      expect(yield* audio.isToneActive({ id: 999 })).toBe(false)
      yield* audio.setToneGain({ id: 999 }, 0.5)
    }),
  )

  it.effect('requires a stream source at the tone graph boundary', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({ global: fake.global })
      yield* audio.unlock
      const context = fake.contexts()[0]
      if (context === undefined) {
        throw new Error('fake audio context was not created')
      }
      const request: ToneRequest = { ...CUE, stream: true }
      expect(() => buildToneGraph({
        context,
        envelope: toneEnvelope(request, context.currentTime),
        master: context.createGain(),
        playbackRate: 1,
        request,
        sampleBuffer: null,
        stereo: false,
        streamSource: null,
      })).toThrow('A streaming source is required')
    }),
  )

  it.effect('requires a sample source for sample-only tone requests', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({ global: fake.global })

      yield* audio.unlock
      yield* audio.playTone({ ...CUE, sampleOnly: true, soundId: 'missing' })

      expect(fake.context()?.bufferSources).toHaveLength(0)
      expect(fake.context()?.oscillators).toHaveLength(0)
      expect((yield* audio.report).refusedTones).toBe(1)
    }),
  )

  it.effect('rejects sample-only requests at the tone graph boundary', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({ global: fake.global })

      yield* audio.unlock
      const context = fake.contexts()[0]
      if (context === undefined) {
        throw new Error('fake audio context was not created')
      }
      const request: ToneRequest = { ...CUE, sampleOnly: true, soundId: 'missing' }
      expect(() => buildToneGraph({
        context,
        envelope: toneEnvelope(request, context.currentTime),
        master: context.createGain(),
        playbackRate: 1,
        request,
        sampleBuffer: null,
        stereo: false,
        streamSource: null,
      })).toThrow('No sample source is available for missing')

      const requestWithoutId: ToneRequest = { ...CUE, sampleOnly: true }
      expect(() => buildToneGraph({
        context,
        envelope: toneEnvelope(requestWithoutId, context.currentTime),
        master: context.createGain(),
        playbackRate: 1,
        request: requestWithoutId,
        sampleBuffer: null,
        stereo: false,
        streamSource: null,
      })).toThrow('No sample source is available for the requested audio')
    }),
  )

  it.effect('uses the host-owned source for a streamed cue without decoding it', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      let sourceCalls = 0
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        createStreamSource: ({ context }) => {
          sourceCalls += 1
          return context.createOscillator()
        },
        sampleManifest: {
          stream: { kind: 'url', stream: true, url: '/audio/stream.ogg' },
        },
      })

      yield* audio.unlock
      yield* audio.playTone({ ...CUE, soundId: 'stream', stream: true })

      expect(sourceCalls).toBe(1)
      expect(fake.context()?.oscillators).toHaveLength(1)
      expect(fake.context()?.bufferSources).toHaveLength(0)
      expect((yield* audio.report).activeTones).toBe(1)
    }),
  )

  it.effect('reports a streamed preload failure when the host provides no stream loader', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        sampleManifest: {
          stream: { kind: 'url', stream: true, url: '/audio/stream.ogg' },
        },
      })

      expect(yield* audio.preloadSamples(['stream'])).toEqual({
        cached: 0,
        failed: 1,
        loaded: 0,
        requested: 1,
      })
    }),
  )

  it.effect('refuses a streamed cue when the host source factory returns null', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        createStreamSource: () => null,
        sampleManifest: {
          stream: { kind: 'url', stream: true, url: '/audio/stream.ogg' },
        },
      })

      yield* audio.unlock
      yield* audio.playTone({ ...CUE, soundId: 'stream', stream: true })

      expect(fake.context()?.oscillators).toHaveLength(0)
      expect((yield* audio.report).refusedTones).toBe(1)
    }),
  )

  it.effect('uses an AudioBufferSource when the host resolves the cue sound id', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        resolveAudioBuffer: (soundId) => soundId === 'block.break' ? { duration: 0.12 } : null,
      })

      yield* audio.unlock
      yield* audio.playTone({ ...CUE, soundId: 'block.break' })

      const context = fake.contexts()[0]
      expect(context?.bufferSources).toHaveLength(1)
      expect(context?.oscillators).toHaveLength(0)
      expect(context?.bufferSources[0]?.buffer?.duration).toBe(0.12)
      expect(context?.bufferSources[0]?.playbackRate.value).toBe(1)
      expect(context?.log.edges[1]?.from).toBe('buffer#2')
    }),
  )

  it.effect('uses sample pitch for playback rate and sample duration', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        resolveAudioBuffer: () => ({ duration: 0.12 }),
      })

      yield* audio.unlock
      yield* audio.playTone({ ...CUE, durationSecs: 9, playbackRate: 2, soundId: 'block.break' })

      const context = fake.contexts()[0]
      expect(context?.bufferSources[0]?.playbackRate.value).toBe(2)
      expect(context?.log.stopped).toEqual([{ atSecs: 0.06, node: 'buffer#2' }])
    }),
  )

  it.effect('uses the requested duration when a sample duration is invalid', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        resolveAudioBuffer: () => ({ duration: Number.NaN }),
      })

      yield* audio.unlock
      yield* audio.playTone({ ...CUE, durationSecs: 0.2, soundId: 'block.break' })

      expect(fake.context()?.log.stopped).toEqual([{ atSecs: 0.2, node: 'buffer#2' }])
    }),
  )

  it.effect('falls back to an oscillator when the sample resolver throws', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        resolveAudioBuffer: () => {
          throw new Error('sample resolver failed')
        },
      })

      yield* audio.unlock
      yield* audio.playTone({ ...CUE, soundId: 'block.break' })

      expect(fake.context()?.bufferSources).toHaveLength(0)
      expect(fake.context()?.oscillators).toHaveLength(1)
    }),
  )

  it.effect('falls back to the oscillator when a sample cannot be resolved', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        resolveAudioBuffer: () => null,
      })

      yield* audio.unlock
      yield* audio.playTone({ ...CUE, soundId: 'missing' })

      const context = fake.contexts()[0]
      expect(context?.bufferSources).toHaveLength(0)
      expect(context?.oscillators).toHaveLength(1)
    }),
  )

  it.effect('falls back to the oscillator when BufferSource construction fails', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio({ bufferSourceThrows: true })
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        resolveAudioBuffer: () => ({ duration: 0.12 }),
      })

      yield* audio.unlock
      yield* audio.playTone({ ...CUE, soundId: 'block.break' })

      const context = fake.contexts()[0]
      expect(context?.bufferSources).toHaveLength(0)
      expect(context?.oscillators).toHaveLength(1)
    }),
  )

  it.effect('releases a finished BufferSource from polyphony accounting', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        resolveAudioBuffer: () => ({ duration: 0.12 }),
      })

      yield* audio.unlock
      yield* audio.playTone({ ...CUE, soundId: 'block.break' })
      expect((yield* audio.report).activeTones).toBe(1)

      fake.context()?.advance(1)
      expect((yield* audio.report).activeTones).toBe(0)
    }),
  )
})

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
        // Do was let anybody TEST it.
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
      // Seventh. `Effect.try` + catch, exactly as the reference did
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
      // Wires mc-audio into its Layer graph at start-up should not thereby ask
      // The device for anything.
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
      // Stand-in. This is the row `docs/design-notes.md` marks as the point of
      // Writing the adapter at all: the invariant was pinned for a fake
      // Backend, and this is the first time it is pinned for the code that
      // Will actually run in a browser.
      const { backend } = withFake({ present: false })
      const audio = yield* backend
      const log = yield* Ref.make<ReadonlyArray<CaptionEvent>>([])

      const service = yield* makeSoundCueService({
        context: Effect.map(audio.availability, (availability) => ({
          availability,
          enabled: true,
          listener: { x: 0, y: 64, z: 0 },
          settings: DEFAULT_VOLUME_SETTINGS,
        })),
      }).pipe(
        Effect.provide(
          Layer.merge(
            Layer.merge(
              Layer.succeed(AudioBackendPort, audio),
              Layer.succeed(CaptionStream, {
                emit: (event) => Ref.update(log, (current) => [...current, event]),
              }),
            ),
            FixedClockLayer({
              monotonicSecs: MonotonicTimeSecs(1),
              wallClockEpochMillis: EpochMillis(0),
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
      // Grep of the reference for `webkitAudioContext|autoplay|userGesture|
      // Unlock` returns nothing.
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
      // Oscillator anyway.
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
      // Promise. `unlock` re-reads `state` afterwards for exactly this case;
      // An implementation that returned 'ready' on resolution would be green
      // Against `resumePolicy: 'reject'` and wrong on the platform where audio
      // Is most fragile.
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
      // Adapter that had never heard of it treats "not suspended" as running
      // And labels its captions `audible` for sound nobody can hear.
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
      // Have done: an interruption that begins and ends between two cues leaves
      // No other trace.
      expect((yield* audio.report).spontaneousStateChanges).toBeGreaterThanOrEqual(2)
    }),
  )

  it.effect("a closed context is 'unavailable', not 'locked' — no gesture revives it", () =>
    Effect.gen(function* () {
      // The distinction `locked` exists to draw. Reporting `locked` here would
      // Leave a UI showing a "click to enable sound" button that can never work.
      const { backend } = withFake()
      const audio = yield* backend

      yield* audio.unlock
      yield* audio.dispose

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
      // Created and wired. What must NOT exist is an oscillator.
      expect(context?.log.created.filter((id) => id.startsWith('osc'))).toStrictEqual([])
      expect(context?.log.started).toStrictEqual([])
      expect((yield* audio.report).refusedTones).toBe(2)
    }),
  )

  it.effect('does not replay refused cues after unlocking', () =>
    Effect.gen(function* () {
      // The policy `domain/webaudio-adapter.ts` argues for: a block-break sound
      // Played at unlock time is about a block that is no longer there. The
      // Information already went out as a caption with reason 'gate-blocked'.
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
      // Reportable.
      expect((yield* audio.report).refusedTones).toBe(2)
    }),
  )

  it.effect('still allocates a handle when refused, which is a documented trap', () =>
    Effect.gen(function* () {
      // `docs/public-api.md` §3 keeps this shape on purpose so that every
      // Backend behaves the same: "I got a handle" never means "it played"
      // Anywhere in this repository. Branch on `availability`.
      const { backend } = withFake({ resumePolicy: 'reject' })
      const audio = yield* backend

      expect((yield* audio.playTone(CUE)).id).toBe(1)
      expect((yield* audio.playTone(CUE)).id).toBe(2)
      // What is different here: the refusal is COUNTED, so the trap is at
      // Least observable from outside.
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
      // Would make every spatialised cue sound centred, which reads as
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
      // Rather than a silent degradation.
      expect((yield* audio.report).stereo).toBe(false)
    }),
  )

  it.effect('applies pan on the panner, in the [-1, 1] the domain already computed', () =>
    Effect.gen(function* () {
      // The reference used a 3D PannerNode with `positionX = pan * 10`
      // (`audio-engine.ts:74-77`), an unexplained fabricated coordinate that
      // Does not equal the stereo pan it stood in for.
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.playTone(CUE)

      const panCalls = fake.context()?.log.params.filter((call) => call.param === 'pan')
      expect(panCalls).toStrictEqual([
        { atSecs: 0, kind: 'assign', node: 'panner#4', param: 'pan', value: -0.5 },
      ])
    }),
  )

  it.effect('carries listener-relative pan from cue policy into the Web Audio panner', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock

      const service = yield* makeSoundCueService({
        context: Effect.succeed({
          availability: 'ready' as const,
          enabled: true,
          listener: { x: 0, y: 64, z: 0 },
          listenerForward: { x: 1, y: 0, z: 0 },
          settings: DEFAULT_VOLUME_SETTINGS,
        }),
      }).pipe(
        Effect.provide(
          Layer.merge(
            Layer.merge(
              Layer.succeed(AudioBackendPort, audio),
              Layer.succeed(CaptionStream, { emit: () => Effect.void }),
            ),
            FixedClockLayer({
              monotonicSecs: MonotonicTimeSecs(1),
              wallClockEpochMillis: EpochMillis(0),
            }),
          ),
        ),
      )

      yield* service.play('blockBreak', { position: { x: 0, y: 64, z: 6 } })

      expect(fake.context()?.log.params.filter((call) => call.param === 'pan')).toStrictEqual([
        { atSecs: 0, kind: 'assign', node: 'panner#4', param: 'pan', value: 0.5 },
      ])
    }),
  )

  it.effect('disconnects partial cue nodes when panner construction fails', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake({ pannerThrows: true })
      const audio = yield* backend
      yield* audio.unlock

      yield* audio.playTone(CUE)

      expect(fake.context()?.log.created).toStrictEqual(['gain#1', 'osc#2', 'gain#3'])
      expect(fake.context()?.log.disconnected).toStrictEqual(['osc#2', 'gain#3'])
      expect((yield* audio.report).activeTones).toBe(0)
      expect((yield* audio.report).refusedTones).toBe(1)
    }),
  )

  it.effect('disconnects the source when cue gain construction fails', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake({ cueGainThrows: true })
      const audio = yield* backend
      yield* audio.unlock

      yield* audio.playTone(CUE)

      expect(fake.context()?.log.created).toStrictEqual(['gain#1', 'osc#2'])
      expect(fake.context()?.log.disconnected).toStrictEqual(['osc#2'])
      expect((yield* audio.report).activeTones).toBe(0)
      expect((yield* audio.report).refusedTones).toBe(1)
    }),
  )

  it.effect('still reports the original construction failure when best-effort cleanup itself fails', () =>
    Effect.gen(function* () {
      // The cleanup catch after a failed graph build is best-effort: a node
      // refusing to disconnect (already disconnected, or a closed context)
      // must not replace or hide the panner-construction failure that
      // triggered cleanup in the first place.
      const { backend } = withFake({ disconnectThrows: true, pannerThrows: true })
      const audio = yield* backend
      yield* audio.unlock

      yield* audio.playTone(CUE)

      expect((yield* audio.report).activeTones).toBe(0)
      expect((yield* audio.report).refusedTones).toBe(1)
    }),
  )

  it.effect('schedules the envelope on the gain, not a flat value', () =>
    Effect.gen(function* () {
      // The whole reason `domain/envelope.ts` exists. A flat `gain.value` plus
      // `oscillator.stop()` is `audio-engine.ts:59` and `:104`, and it clicks
      // At both ends.
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.playTone(CUE)

      const context = fake.context()
      const cueGain = context?.log.params.filter(
        (call) => call.param === 'gain' && call.node === 'gain#3',
      )

      expect(cueGain).toStrictEqual([
        { atSecs: 0, kind: 'set', node: 'gain#3', param: 'gain', value: 0 },
        { atSecs: ATTACK_SECS, kind: 'ramp', node: 'gain#3', param: 'gain', value: 0.4 },
        { atSecs: 0.07 - RELEASE_SECS, kind: 'set', node: 'gain#3', param: 'gain', value: 0.4 },
        { atSecs: 0.07, kind: 'ramp', node: 'gain#3', param: 'gain', value: 0 },
      ])
    }),
  )

  it.effect('keeps an official per-tone gain above unity on the Web Audio graph', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.playTone({ ...CUE, gain: 4 })

      const cuePeak = fake.context()?.log.params.find(
        (call) => call.node === 'gain#3' && call.kind === 'ramp' && call.value > 0,
      )
      expect(cuePeak?.value).toBe(4)
    }),
  )

  it.effect('starts and stops against the audio clock, never a wall clock', () =>
    Effect.gen(function* () {
      // `pnpm check:deps` bans `Date.now()`, `new Date()` and
      // `performance.now()`, and the `mc-kernel-allow-time-source` escape hatch
      // Is NOT taken anywhere in this repository. Scheduling rides
      // `context.currentTime`, which is the device's own monotonic clock —
      // Anticipated by `docs/public-api.md` §7 and true.
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock

      fake.context()?.advance(5)
      yield* audio.playTone(CUE)

      expect(fake.context()?.log.started).toStrictEqual([{ atSecs: 5, node: 'osc#2' }])
      expect(fake.context()?.log.stopped).toStrictEqual([{ atSecs: 5.07, node: 'osc#2' }])
    }),
  )

  it.effect('uses the default waveform when the caller does not author one', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.playTone(CUE)

      expect(fake.context()?.oscillators[0]?.type).toBe(DEFAULT_TONE_WAVE)
      expect(DEFAULT_TONE_WAVE).toBe('sine')
    }),
  )

  it.effect('applies an authored waveform to the oscillator', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.playTone({ ...CUE, wave: 'sawtooth' })

      expect(fake.context()?.oscillators[0]?.type).toBe('sawtooth')
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

  it.effect('ignores cleanup failures after a tone ends', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake({ disconnectThrows: true })
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.playTone(CUE)

      fake.context()?.advance(1)

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
      // Sounds like 0.25. `test/volume.test.ts` pins the arithmetic; this pins
      // That the adapter honours it — master reaches exactly one node.
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.setMasterGain(0.5)
      yield* audio.playTone(CUE)

      const context = fake.context()
      const masterWrites = context?.log.params.filter((call) => call.node === 'gain#1')
      expect(masterWrites).toStrictEqual([
        { atSecs: 0, kind: 'assign', node: 'gain#1', param: 'gain', value: 0.8 },
        { atSecs: 0, kind: 'assign', node: 'gain#1', param: 'gain', value: 0.5 },
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
      // Default and was corrected on the next settings change would play the
      // First cue at the wrong volume.
      const { fake, backend } = withFake()
      const audio = yield* backend

      yield* audio.setMasterGain(0.25)
      expect(fake.constructorCalls()).toBe(0)

      yield* audio.unlock

      expect(fake.context()?.log.params).toStrictEqual([
        { atSecs: 0, kind: 'assign', node: 'gain#1', param: 'gain', value: 0.25 },
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

  it.effect('mutes without forgetting the configured volume', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.setMasterGain(0.35)
      yield* audio.setMuted(true)
      yield* audio.setMasterGain(0.6)

      expect((yield* audio.report).muted).toBe(true)
      expect(fake.context()?.log.params.at(-1)?.value).toBe(0)

      yield* audio.setMuted(false)
      expect((yield* audio.report).muted).toBe(false)
      expect(fake.context()?.log.params.at(-1)?.value).toBe(0.6)
    }),
  )

  it.effect('remembers a mute set before the context existed', () =>
    Effect.gen(function* () {
      // Same shape as "remembers a gain set before the context existed"
      // above: a settings load can happen before the first cue, and muting
      // has nothing to write to yet.
      const { fake, backend } = withFake()
      const audio = yield* backend

      yield* audio.setMuted(true)
      expect(fake.constructorCalls()).toBe(0)
      expect((yield* audio.report).muted).toBe(true)

      yield* audio.unlock
      expect(fake.context()?.log.params).toStrictEqual([
        { atSecs: 0, kind: 'assign', node: 'gain#1', param: 'gain', value: 0 },
      ])
    }),
  )
})

describe('resource limits and lifecycle', () => {
  it.effect('does not allocate nodes or consume polyphony for a silent loop', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({ global: fake.global, maxConcurrentTones: 1 })
      yield* audio.unlock

      expect((yield* audio.playTone({ ...CUE, gain: 0, loop: true })).id).toBe(1)
      expect(fake.context()?.log.created).toStrictEqual(['gain#1'])
      expect(yield* audio.report).toMatchObject({
        activeTones: 0,
        capacityRefusals: 0,
        refusedTones: 0,
      })

      yield* audio.playTone({ ...CUE, loop: true })
      expect(fake.context()?.oscillators).toHaveLength(1)
    }),
  )

  it.effect('discards cues beyond the configured simultaneous-tone limit', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({ global: fake.global, maxConcurrentTones: 2 })
      yield* audio.unlock

      yield* audio.playTone({ ...CUE, loop: true })
      yield* audio.playTone({ ...CUE, loop: true })
      yield* audio.playTone({ ...CUE, loop: true })

      expect(fake.context()?.oscillators).toHaveLength(2)
      expect(yield* audio.report).toMatchObject({
        activeTones: 2,
        capacityRefusals: 1,
        refusedTones: 1,
      })
    }),
  )

  it.effect('disposes once and never recreates a context', () =>
    Effect.gen(function* () {
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock
      yield* audio.playTone({ ...CUE, loop: true })

      yield* audio.dispose
      const disconnected = [...(fake.context()?.log.disconnected ?? [])]
      yield* audio.dispose

      expect(fake.context()?.log.disconnected).toStrictEqual(disconnected)
      expect(yield* audio.availability).toBe('unavailable')
      expect(yield* audio.unlock).toBe('unavailable')
      yield* audio.playTone(CUE)
      expect(fake.constructorCalls()).toBe(1)
      expect(yield* audio.report).toMatchObject({ activeTones: 0, disposed: true })
    }),
  )

  it.effect('disposes cleanly even when the device refuses to close', () =>
    Effect.gen(function* () {
      const { backend } = withFake({ closeThrows: true })
      const audio = yield* backend
      yield* audio.unlock

      yield* audio.dispose

      expect(yield* audio.report).toMatchObject({ disposed: true })
      expect(yield* audio.availability).toBe('unavailable')
    }),
  )

  it.effect('clears decoded samples when disposed', () =>
    Effect.gen(function* () {
      const fake = makeFakeWebAudio()
      const audio = yield* makeWebAudioBackend({
        global: fake.global,
        sampleManifest: { step: { data: new ArrayBuffer(4), kind: 'array-buffer' } },
      })

      expect(yield* audio.preloadSamples()).toMatchObject({ loaded: 1 })
      yield* audio.dispose

      expect(yield* audio.preloadSamples()).toEqual({ cached: 0, failed: 1, loaded: 0, requested: 1 })
    }),
  )

  it.effect('disposes cleanly when no context was ever built', () =>
    Effect.gen(function* () {
      // Unlike the test above, nothing here calls unlock, playTone, or
      // preloadSamples — none of which ever ran, so ensureRuntime never ran
      // either. dispose() must not assume a runtime exists just because it
      // is the natural end of a backend's life.
      const { fake, backend } = withFake()
      const audio = yield* backend

      yield* audio.dispose
      expect(fake.constructorCalls()).toBe(0)
      expect(yield* audio.report).toMatchObject({ activeTones: 0, disposed: true })
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
      // Cut mid-cycle at full amplitude is the loudest click this adapter could
      // Produce — a sustained tone is at full gain by definition.
      const { fake, backend } = withFake()
      const audio = yield* backend
      yield* audio.unlock

      const handle = yield* audio.playTone({ ...CUE, gain: 0.28, loop: true })
      fake.context()?.advance(3)
      yield* audio.stopTone(handle)

      const cueGain = fake
        .context()
        ?.log.params.filter((call) => call.node === 'gain#3')
        .slice(2)

      expect(cueGain).toStrictEqual([
        { atSecs: 3, kind: 'cancel', node: 'gain#3', param: 'gain', value: 0 },
        { atSecs: 3, kind: 'set', node: 'gain#3', param: 'gain', value: 0.28 },
        { atSecs: 3 + RELEASE_SECS, kind: 'ramp', node: 'gain#3', param: 'gain', value: 0 },
      ])
      expect(fake.context()?.log.stopped).toStrictEqual([
        { atSecs: 3 + RELEASE_SECS, node: 'osc#2' },
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
      // Its attack: a cancel that makes the sound briefly louder.
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
      // Reference implementation for `webkitAudioContext` returns nothing, so
      // That browser had no audio at all and nobody noticed.
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
      // Outcome from construction throwing, and both have to end as a value.
      const { backend } = withFake({ wiringThrows: true })
      const audio = yield* backend

      expect(yield* audio.availability).toBe('unavailable')
      expect((yield* audio.report).contextAttempted).toBe(true)
    }),
  )

  it.effect('retries construction on a later call rather than caching the failure', () =>
    Effect.gen(function* () {
      // Deliberate: a page whose first context failed because six were already
      // Open can succeed later, once one has been closed. Caching "no" would
      // Make that page permanently silent.
      const { fake, backend } = withFake({ constructionThrows: true })
      const audio = yield* backend

      yield* audio.availability
      yield* audio.availability
      expect(fake.constructorCalls()).toBe(2)
    }),
  )
})

/**
 * The soundboard preview's pure parts.
 *
 * `pnpm preview` is not a gate and this file does not try to make it one. What
 * it pins is the property that makes the preview worth having: THE PREVIEW
 * REPORTS, IT DOES NOT DECIDE. Every number on screen comes from `domain/` or
 * from the adapter's own calls, so a frame cannot stay correct after the code
 * stops being.
 *
 * The frames asserted below are the ones `docs/testing.md` §3 lists as the
 * things a soundboard has to make visible, and the first of them is the reason
 * the app exists: audio locked, no tone, caption anyway.
 *
 * Note what is NOT asserted: layout, colour, alignment, glyph choice. Those are
 * taste and they change; asserting them would make this a snapshot test that
 * fails on every cosmetic edit and teaches everyone to regenerate it without
 * reading. What is asserted is the presence or absence of specific CLAIMS.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Ref } from 'effect'
import { ClockPort, EpochMillis } from '@nerima-games/mc-kernel'
import { AudioBackendPort } from '../src/domain/backend-port'
import { type CaptionEvent, CaptionStream } from '../src/domain/caption'
import { SOUND_CUE_IDS } from '../src/domain/cue'
import { makeSoundCueService } from '../src/domain/engine'
import { makeWebAudioBackend } from '../src/domain/webaudio-adapter'
import { bar, bipolarBar, makeStyle, sparkline, visibleLength } from '../apps/preview-soundboard/ansi'
import { parseArguments } from '../apps/preview-soundboard/options'
import {
  INITIAL_STATE,
  PANELS,
  type PreviewState,
  adjustPlayerY,
  adjustVolume,
  applyMusic,
  cueContext,
  cyclePanel,
  moveCursor,
  moveSource,
  selectedCue,
  toggleEnabled,
  toggleNight,
  withCaptions,
} from '../apps/preview-soundboard/state'
import { type Snapshot, renderFrame } from '../apps/preview-soundboard/views'
import { type FakeWebAudioOptions, makeFakeWebAudio } from './fake-webaudio'

const style = makeStyle(false)

/**
 * Build a frame the way `main.ts` does: the REAL service, the REAL adapter, the
 * same test double. Nothing about the audio is re-derived here, which is the
 * whole claim being tested.
 */
const frameFor = (input: {
  readonly fakeOptions?: FakeWebAudioOptions
  readonly unlock?: boolean
  readonly state?: (state: PreviewState) => PreviewState
  readonly play?: boolean
}): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function*  buildFrame() {
    const fake = makeFakeWebAudio(input.fakeOptions ?? {})
    const backend = yield* makeWebAudioBackend({ global: fake.global })
    const captionLog = yield* Ref.make<ReadonlyArray<CaptionEvent>>([])

    let state = input.state === undefined ? INITIAL_STATE : input.state(INITIAL_STATE)

    const service = yield* makeSoundCueService({
      context: Effect.map(backend.availability, (availability) => cueContext(state, availability)),
    }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.merge(
            Layer.succeed(AudioBackendPort, backend),
            Layer.succeed(CaptionStream, {
              emit: (event) => Ref.update(captionLog, (current) => [...current, event]),
            }),
          ),
          Layer.succeed(ClockPort, {
            monotonicSecs: Effect.sync(() => state.nowSecs),
            wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
          }),
        ),
      ),
    )

    if (input.unlock === true) {
      yield* backend.unlock
    }
    if (input.play !== false) {
      yield* service.play(selectedCue(state), { position: state.source })
    }

    state = withCaptions(state, yield* Ref.get(captionLog))

    const context = fake.context()
    const snapshot: Snapshot = {
      audioClockSecs: context?.currentTime ?? 0,
      availability: yield* backend.availability,
      log: context?.log ?? {
        created: [],
        edges: [],
        disconnected: [],
        params: [],
        started: [],
        stopped: [],
      },
      report: yield* backend.report,
      state,
    }

    return renderFrame(snapshot, style, 96, true)
  })

const joined = (lines: ReadonlyArray<string>): string => lines.join('\n')

describe('the frame the preview exists to show', () => {
  it.effect('locked audio: the caption is on screen and no tone was planned', () =>
    Effect.gen(function* () {
      // `docs/testing.md` §3-2 — 「オーディオがロックされた状態（初回訪問、まだ
      // クリックしていない）で字幕だけが出ることを目視できる」. This is DN-1's
      // Visual form and the single most important thing the app draws.
      const text = joined(yield* frameFor({ state: (s) => ({ ...s, panel: 'board' }) }))

      expect(text).toContain('locked')
      expect(text).toContain('"Block breaks"')
      expect(text).toContain('gate-blocked')
      // No gain, because no tone was planned — and the caption is there anyway.
      expect(text).toContain('captions  (1 visible of 1 fired)')
    }),
  )

  it.effect('unlocked audio: the same cue reports audible and carries a gain', () =>
    Effect.gen(function* () {
      const text = joined(
        yield* frameFor({ state: (s) => ({ ...s, panel: 'board' }), unlock: true }),
      )

      expect(text).toContain('ready')
      expect(text).toContain('audible')
      expect(text).not.toContain('gate-blocked')
    }),
  )

  it.effect('the graph panel names where the guard stopped, and what it would have built', () =>
    Effect.gen(function* () {
      // "Nothing happened" is otherwise indistinguishable from "the preview is
      // Broken", which is how a preview stops being read.
      const text = joined(yield* frameFor({ state: (s) => ({ ...s, panel: 'graph' }) }))

      expect(text).toContain('REFUSED before any node was built')
      expect(text).toContain('the browser autoplay policy has not been satisfied')
      expect(text).toContain('would have built:')
      expect(text).toContain('press u — that is the user gesture')
    }),
  )

  it.effect('the graph panel shows the edges the adapter actually connected', () =>
    Effect.gen(function* () {
      const text = joined(
        yield* frameFor({ state: (s) => ({ ...s, panel: 'graph' }), unlock: true }),
      )

      expect(text).toContain('osc#2        -> gain#3')
      expect(text).toContain('gain#3       -> panner#4')
      expect(text).toContain('panner#4     -> gain#1')
      expect(text).toContain('gain#1       -> destination')
    }),
  )

  /**
   * THE TEST THAT MAKES THE ONE ABOVE MEAN ANYTHING.
   *
   * The assertions above are satisfied just as well by a hard-coded edge list —
   * measured: replacing the panel's `log.edges.map(...)` with four literal
   * strings left the whole preview suite green. A preview that DESCRIBES the
   * graph instead of READING it is exactly the decorative preview this app was
   * written to not be, so the claim has to be pinned where a literal list would
   * be WRONG.
   *
   * Two configurations produce two different edge sets, and no fixed list can
   * be right for more than one of them.
   */
  it.effect('...and the edges CHANGE with the configuration, so they cannot be hard-coded', () =>
    Effect.gen(function* () {
      const graphPanel = (state: PreviewState): PreviewState => ({ ...state, panel: 'graph' })

      // 1. Locked: the context and its master node exist, and NOTHING else was
      //    Connected. The reference built the whole chain in this exact state.
      const locked = joined(yield* frameFor({ state: graphPanel }))
      expect(locked).toContain('gain#1       -> destination')
      expect(locked).not.toContain('osc#2        -> gain#3')
      expect(locked).not.toContain('panner#4')

      // 2. No backend at all: not even a master node.
      const absent = joined(
        yield* frameFor({ fakeOptions: { present: false }, state: graphPanel }),
      )
      expect(absent).toContain('(nothing connected)')
      // No NODE IDS anywhere: not even the master gain was created. Asserted on
      // Ids rather than on `-> destination`, because the "would have built"
      // Line legitimately names destination while nothing exists.
      expect(absent).not.toContain('gain#1')
      expect(absent).not.toContain('osc#')
    }),
  )

  it.effect('the envelope is drawn, and starts and ends at silence', () =>
    Effect.gen(function* () {
      const lines = yield* frameFor({ state: (s) => ({ ...s, panel: 'graph' }), unlock: true })
      const curve = lines.find((line) => line.trim().startsWith('_'))

      expect(curve).toBeDefined()
      // The claim `domain/envelope.ts` makes, drawn: silence at both ends and
      // Something in between. A flat-topped block starting and ending at full
      // Height is the reference's click.
      expect(curve?.trim().startsWith('_')).toBe(true)
      expect(curve?.trim().endsWith('_')).toBe(true)
      expect(curve).toContain('8')
    }),
  )

  it.effect('explains that no audio nodes exist when no context was created', () =>
    Effect.gen(function* () {
      const text = joined(
        yield* frameFor({
          fakeOptions: { present: false },
          state: (s) => ({ ...s, panel: 'graph' }),
        }),
      )

      expect(text).toContain('no audio nodes: context was not created')
      // ...and it does not offer a gesture that cannot help.
      expect(text).toContain('no user gesture can fix this')
      expect(text).not.toContain('press u — that is the user gesture')
    }),
  )

  it.effect('never claims to have made a sound', () =>
    Effect.gen(function* () {
      const text = joined(yield* frameFor({ unlock: true }))
      expect(text).toContain('NOTHING HERE MAKES A SOUND')
    }),
  )
})

describe('the mix panel shows the arithmetic DN-2 protects', () => {
  it.effect('per-cue gain does not move when master moves; the master node does', () =>
    Effect.gen(function* () {
      // The visual form of `test/volume.test.ts`. A build that multiplied
      // Master in twice would show the left column changing with the slider.
      const quiet = joined(
        yield* frameFor({
          state: (s) => adjustVolume({ ...s, panel: 'mix' }, 'master', -0.5),
          unlock: true,
        }),
      )
      const loud = joined(
        yield* frameFor({
          state: (s) => adjustVolume({ ...s, panel: 'mix' }, 'master', 0.2),
          unlock: true,
        }),
      )

      // Same per-cue gain in both.
      expect(quiet).toContain('per-cue gain          0.3000')
      expect(loud).toContain('per-cue gain          0.3000')
      // Different master node gain.
      expect(quiet).toContain('master node gain      0.3000')
      expect(loud).toContain('master node gain      1.0000')
      // ...and the product, applied once.
      expect(quiet).toContain('what a speaker gets   0.0900')
    }),
  )

  it.effect('shows attenuation and pan changing as the source moves', () =>
    Effect.gen(function* () {
      const near = joined(
        yield* frameFor({ state: (s) => ({ ...s, panel: 'mix' }), unlock: true }),
      )
      const far = joined(
        yield* frameFor({
          state: (s) => moveSource({ ...s, panel: 'mix' }, 20),
          unlock: true,
        }),
      )

      expect(near).toContain('distance                4.00 blocks')
      expect(far).toContain('distance               24.00 blocks')
      expect(near).toContain('attenuation           0.7500')
      expect(far).toContain('attenuation           0.3333')
    }),
  )
})

describe('the music panel makes DN-5 visible', () => {
  it.effect('says NO ACTION when the desired track is already playing', () =>
    Effect.gen(function* () {
      // The whole reason the plan is printed rather than only the active track:
      // A machine that restarted the track every frame would look identical.
      const once = applyMusic({ ...INITIAL_STATE, panel: 'music' })
      const twice = applyMusic(once)

      expect(Option.getOrNull(once.activeMusic)).toBe('day')
      expect(twice.notes[0]).toContain('NO ACTION')
      expect(twice.lastMusicPlan?.shouldStopActiveTrack).toBe(false)
      expect(Option.isNone(twice.lastMusicPlan?.environmentToPlay ?? Option.none())).toBe(true)

      const text = joined(
        yield* frameFor({ play: false, state: () => twice, unlock: true }),
      )
      expect(text).toContain('play: nothing')
    }),
  )

  it.effect('stops and starts on a real change, and honours the strict cave threshold', () =>
    Effect.sync(() => {
      // DN-4: the comparison is strictly `<`, so standing exactly on 40 is
      // Surface. A one-block step at the threshold must not flip the music.
      const surface = applyMusic({ ...INITIAL_STATE, playerY: 40 })
      expect(Option.getOrNull(surface.activeMusic)).toBe('day')

      const cave = applyMusic(adjustPlayerY(surface, -1))
      expect(Option.getOrNull(cave.activeMusic)).toBe('cave')
      expect(cave.lastMusicPlan?.shouldStopActiveTrack).toBe(true)

      const night = applyMusic(toggleNight(adjustPlayerY(cave, 24)))
      expect(Option.getOrNull(night.activeMusic)).toBe('night')
    }),
  )

  it.effect('stops the track when the player turns audio off mid-track', () =>
    Effect.sync(() => {
      const playing = applyMusic(INITIAL_STATE)
      const muted = applyMusic(toggleEnabled(playing))

      expect(muted.lastMusicPlan?.shouldStopActiveTrack).toBe(true)
      expect(Option.isNone(muted.activeMusic)).toBe(true)
      expect(muted.notes[0]).toContain('stop, play nothing')
    }),
  )
})

describe('state transitions', () => {
  it.effect('the cue cursor wraps in both directions over the whole roster', () =>
    Effect.sync(() => {
      expect(selectedCue(moveCursor(INITIAL_STATE, -1))).toBe(
        SOUND_CUE_IDS[SOUND_CUE_IDS.length - 1],
      )
      let state = INITIAL_STATE
      for (let index = 0; index < SOUND_CUE_IDS.length; index += 1) {
        state = moveCursor(state, 1)
      }
      expect(state.cueIndex).toBe(0)
    }),
  )

  it.effect('the panel cycle visits every panel and returns', () =>
    Effect.sync(() => {
      let state = INITIAL_STATE
      const seen = [state.panel]
      for (let index = 0; index < PANELS.length; index += 1) {
        state = cyclePanel(state)
        seen.push(state.panel)
      }
      expect(new Set(seen).size).toBe(PANELS.length)
      expect(state.panel).toBe(INITIAL_STATE.panel)
    }),
  )

  it.effect('volume adjustment clamps into [0, 1] without accumulating float dust', () =>
    Effect.sync(() => {
      let state = INITIAL_STATE
      for (let index = 0; index < 30; index += 1) {
        state = adjustVolume(state, 'sfx', 0.05)
      }
      expect(state.settings.sfx).toBe(1)
      for (let index = 0; index < 40; index += 1) {
        state = adjustVolume(state, 'sfx', -0.05)
      }
      // Exactly 0, not 5.551e-17. The mix panel prints four decimals and a
      // Value of -0.0000 would read as a bug in the arithmetic it exists to
      // Vouch for.
      expect(state.settings.sfx).toBe(0)
    }),
  )
})

describe('option parsing', () => {
  it.effect('accepts the flags the README documents', () =>
    Effect.sync(() => {
      const options = parseArguments([
        '--panel',
        'graph',
        '--unlocked',
        '--once',
        '--ascii',
        '--play',
        'levelUp',
        '--width',
        '80',
      ])
      expect(options.errors).toStrictEqual([])
      expect(options).toMatchObject({
        ascii: true,
        once: true,
        panel: 'graph',
        play: 'levelUp',
        unlocked: true,
        width: 80,
      })
    }),
  )

  it.effect('ignores a bare -- , which pnpm 9 forwards out of npm habit', () =>
    Effect.sync(() => {
      expect(parseArguments(['--', '--once']).once).toBe(true)
      expect(parseArguments(['--', '--once']).errors).toStrictEqual([])
    }),
  )

  it.effect('rejects an unknown flag rather than silently ignoring it', () =>
    Effect.sync(() => {
      expect(parseArguments(['--lowd']).errors).toStrictEqual(['unknown flag: --lowd'])
      expect(parseArguments(['--panel', 'nope']).errors).toStrictEqual([
        '--panel: "nope" is not one of board, graph, mix, music',
      ])
      expect(parseArguments(['--width']).errors).toStrictEqual(['--width: "" is not a number'])
    }),
  )

  it.effect('rejects contradictory flags rather than quietly preferring one', () =>
    Effect.sync(() => {
      // A frame that cannot be explained from its own command line is worse
      // Than an error message.
      expect(parseArguments(['--unlocked', '--refuse']).errors).toStrictEqual([
        '--unlocked and --refuse contradict each other',
      ])
      expect(parseArguments(['--unlocked', '--absent']).errors).toStrictEqual([
        '--unlocked and --absent contradict each other',
      ])
    }),
  )
})

describe('the drawing primitives', () => {
  it.effect('bar and sparkline clamp rather than overflowing their width', () =>
    Effect.sync(() => {
      expect(bar(0.5, 10)).toBe('#####.....')
      expect(bar(2, 10)).toBe('##########')
      expect(bar(-1, 10)).toBe('..........')
      expect(bar(Number.NaN, 10)).toBe('..........')
      expect(sparkline([0, 1], true, 1)).toBe('_8')
      expect(sparkline([5], true, 1)).toBe('8')
    }),
  )

  it.effect('the pan bar distinguishes dead centre from very slightly left', () =>
    Effect.sync(() => {
      // `domain/engine.ts` omits `pan` for a non-spatial cue rather than
      // Reporting a misleading zero, so the two have to look different here.
      const centre = bipolarBar(0, 4)
      const left = bipolarBar(-1, 4)
      const right = bipolarBar(1, 4)
      expect(centre).toBe('----O----')
      expect(left).toBe('O---|----')
      expect(right).toBe('----|---O')
    }),
  )

  it.effect('visibleLength ignores escape sequences, so colour cannot break alignment', () =>
    Effect.sync(() => {
      const coloured = makeStyle(true)
      expect(visibleLength(coloured.bold('abc'))).toBe(3)
      expect(visibleLength(coloured.ink('31', 'hello'))).toBe(5)
    }),
  )
})

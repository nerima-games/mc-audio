/**
 * `apps/preview-soundboard` — every cue, auditioned as far as a terminal can.
 *
 * plan.md §3.6 asks mc-audio for 「サウンドボードプレビュー（全キューを一覧から
 * 試聴）」, and plan.md §6 Step 2 makes it half the completion criterion: tests
 * green AND the built-in preview operable. plan.md §4.1 requires it to live
 * with the thing it verifies, so it is a dev application INSIDE mc-audio — not
 * a package, not part of `index.ts`, and not something a consumer can import.
 * `docs/architecture.md` §4-2 already recorded that it needs no
 * mc-playground-kit.
 *
 * ---------------------------------------------------------------------------
 * THE DECISION: drive the real adapter, and draw what it did
 * ---------------------------------------------------------------------------
 *
 * A soundboard cannot make a noise in a terminal. That could have made this app
 * decorative — a menu of cue names with a beep-shaped ASCII drawing beside each
 * one — and a decorative preview is worse than none, because it looks like
 * verification.
 *
 * So this app makes no claim of its own. It builds the REAL
 * `makeSoundCueService` over the REAL `makeWebAudioBackend`, pointed at
 * `test/fake-webaudio.ts` — the same test double the adapter tests use — and
 * every number on screen is read back out of what that ran:
 *
 *   - the CAPTIONS come from `domain/engine.ts` emitting them, through
 *     `visibleCaptions`, with the shipped 2.5s expiry and five-row cap;
 *   - the NODE GRAPH is the fake's log of what the adapter connected;
 *   - the GAINS come from `planCue` and `masterNodeGain`;
 *   - the ENVELOPE is sampled from `gainAt`;
 *   - the AVAILABILITY is asked of the adapter, every frame.
 *
 * Nothing is recomputed here. A preview that re-derived its answers would keep
 * drawing a correct picture after the code stopped being correct — which is the
 * specific way previews rot.
 *
 * ---------------------------------------------------------------------------
 * What this CANNOT tell you, stated at the top rather than buried
 * ---------------------------------------------------------------------------
 *
 * It cannot tell you anything sounds right. Not that the click is gone, not
 * that a footstep at twelve blocks is quiet enough to ignore and loud enough to
 * notice, not that 174.61 Hz and 130.81 Hz read as different pieces of music
 * rather than as two beeps. Those are listening tests and `README.md` lists
 * them as such.
 *
 * It also cannot tell you what a browser will do: `test/fake-webaudio.ts` is
 * TOLD whether to refuse a `resume()`, so `--refuse` demonstrates the adapter's
 * response to a refusal and never predicts one.
 *
 * ---------------------------------------------------------------------------
 * Constraints this app is written under
 * ---------------------------------------------------------------------------
 *
 *  - `apps` is in `SCAN_ROOTS` (scripts/check-dependency-whitelist.ts), so the
 *    preview's imports are gated like any other source here. It imports this
 *    repository's own modules and `effect`, and nothing else.
 *  - The `Date.now()` / `new Date()` / `performance.now()` ban applies and is
 *    satisfied without an escape hatch. There are two virtual clocks and a
 *    keystroke advances each; see `terminal.ts`.
 *  - `pnpm verify` does not run this app. `tsconfig.preview.json` typechecks
 *    it, `pnpm lint` lints it, and `test/soundboard-preview.test.ts` covers its
 *    pure parts; `pnpm preview` is not a gate.
 */
import { Effect, Layer, Ref } from 'effect'
import { ClockPort, EpochMillis } from '@nerima-games/mc-kernel'
import { AudioBackendPort } from '../../src/domain/backend-port'
import { CaptionStream, type CaptionEvent } from '../../src/domain/caption'
import { isSoundCueId, SOUND_CUE_IDS } from '../../src/domain/cue'
import { makeSoundCueService } from '../../src/domain/engine'
import { makeWebAudioBackend, type WebAudioBackend } from '../../src/domain/webaudio-adapter'
import { makeFakeWebAudio, type FakeAudioContext } from '../../test/fake-webaudio'
import { makeStyle } from './ansi'
import { parseArguments, USAGE, type PreviewOptions } from './options'
import {
  adjustPlayerY,
  adjustVolume,
  advanceCaptionClock,
  applyMusic,
  cueContext,
  cyclePanel,
  INITIAL_STATE,
  moveCursor,
  moveSource,
  note,
  selectedCue,
  selectPanel,
  toggleEnabled,
  toggleNight,
  withCaptions,
  type PreviewState,
} from './state'
import {
  enterFullScreen,
  isInteractive,
  leaveFullScreen,
  onExit,
  onInputEnd,
  onKey,
  onResize,
  paintFrame,
  screenSize,
  writeLine,
} from './terminal'
import { renderFrame, type Snapshot } from './views'

const options: PreviewOptions = parseArguments(process.argv.slice(2))

if (options.help) {
  for (const line of USAGE) {
    writeLine(line)
  }
  process.exit(0)
}

if (options.play !== undefined && !isSoundCueId(options.play)) {
  writeLine(`--play: "${options.play}" is not a cue. The roster is:`)
  writeLine(`  ${SOUND_CUE_IDS.join(', ')}`)
  process.exit(1)
}

if (options.errors.length > 0) {
  for (const error of options.errors) {
    writeLine(`error: ${error}`)
  }
  writeLine('')
  for (const line of USAGE) {
    writeLine(line)
  }
  process.exit(1)
}

const style = makeStyle(!options.ascii)

const fake = makeFakeWebAudio({
  present: !options.absent,
  stereo: options.stereo,
  resumePolicy: options.refuse ? 'reject' : 'allow',
})

/**
 * One `Ref` for the caption log, wired into the real service.
 *
 * The service writes here; the state reads it. That is the same seam mx-ui will
 * use when it subscribes to the caption stream for real, so the preview is
 * exercising the intended shape rather than a convenience.
 */
const program = Effect.gen(function* () {
  const backend: WebAudioBackend = yield* makeWebAudioBackend({ global: fake.global })
  const captionLog = yield* Ref.make<ReadonlyArray<CaptionEvent>>([])

  let state: PreviewState = selectPanel(INITIAL_STATE, options.panel)

  const layers = Layer.merge(
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
  )

  const service = yield* makeSoundCueService({
    context: Effect.map(backend.availability, (availability) => cueContext(state, availability)),
  }).pipe(Effect.provide(layers))

  const snapshot = (): Effect.Effect<Snapshot> =>
    Effect.gen(function* () {
      const context: FakeAudioContext | null = fake.context()
      return {
        state: withCaptions(state, yield* Ref.get(captionLog)),
        availability: yield* backend.availability,
        report: yield* backend.report,
        log: context?.log ?? {
          created: [],
          edges: [],
          disconnected: [],
          params: [],
          started: [],
          stopped: [],
        },
        audioClockSecs: context?.currentTime ?? 0,
      }
    })

  const draw = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const current = yield* snapshot()
      const width = Math.max(72, options.width ?? screenSize().columns)
      const lines = renderFrame(current, style, width, options.ascii)
      if (options.once) {
        for (const line of lines) {
          writeLine(line)
        }
      } else {
        paintFrame(lines)
      }
    })

  const playSelected = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const cueId = selectedCue(state)
      const definition = state.source
      yield* service.play(cueId, { position: definition })
      state = note(state, `fired ${cueId}`)
    })

  if (options.unlocked) {
    yield* backend.unlock
  }

  if (options.play !== undefined && isSoundCueId(options.play)) {
    const chosen = SOUND_CUE_IDS.indexOf(options.play)
    state = { ...state, cueIndex: chosen }
    yield* playSelected()
  }

  if (options.once || !isInteractive()) {
    yield* draw()
    return
  }

  // -------------------------------------------------------------------------
  // Interactive mode
  // -------------------------------------------------------------------------

  const handled = (key: string): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      switch (key) {
        case 'up':
          state = moveCursor(state, -1)
          return true
        case 'down':
          state = moveCursor(state, 1)
          return true
        case 'enter':
          yield* playSelected()
          return true
        case 'tab':
          state = cyclePanel(state)
          return true
        case 'u': {
          // THE USER GESTURE. In a browser this is a click handler; here it is
          // a keystroke, and it is the only thing that can move `locked` to
          // `ready`.
          const availability = yield* backend.unlock
          state = note(state, `unlock -> ${availability}`)
          return true
        }
        case 'a':
          state = toggleEnabled(state)
          state = note(state, `player audio switch -> ${state.enabled ? 'on' : 'off'}`)
          return true
        case 'i': {
          // The iOS phone call. `'interrupted'` is the fourth AudioContextState
          // and the reason `domain/webaudio-surface.ts` exists in the form it
          // does; this key is how you watch a `ready` context become `locked`
          // without anybody asking.
          const context = fake.context()
          if (context === null) {
            state = note(state, 'interrupt: no context yet — play a cue first')
            return true
          }
          if (context.state === 'interrupted') {
            context.endInterruption()
            state = note(state, 'interruption ended')
          } else {
            context.interrupt()
            state = note(state, 'interrupted (iOS phone call)')
          }
          return true
        }
        case 'x':
          yield* backend.dispose
          state = note(state, 'context disposed — unavailable, and no gesture revives it')
          return true
        case '[':
          state = advanceCaptionClock(state, -0.25)
          return true
        case ']':
          state = advanceCaptionClock(state, 0.25)
          return true
        case '-':
          fake.context()?.advance(0.005)
          return true
        case '+':
        case '=':
          fake.context()?.advance(0.05)
          return true
        case '1':
          state = adjustVolume(state, 'master', -0.05)
          return true
        case '!':
          state = adjustVolume(state, 'master', 0.05)
          return true
        case '2':
          state = adjustVolume(state, 'sfx', -0.05)
          return true
        case '@':
          state = adjustVolume(state, 'sfx', 0.05)
          return true
        case '3':
          state = adjustVolume(state, 'music', -0.05)
          return true
        case '#':
          state = adjustVolume(state, 'music', 0.05)
          return true
        case ',':
          state = moveSource(state, -1)
          return true
        case '.':
          state = moveSource(state, 1)
          return true
        case 'w':
          state = adjustPlayerY(state, 1)
          return true
        case 's':
          state = adjustPlayerY(state, -1)
          return true
        case 'n':
          state = toggleNight(state)
          return true
        case 'm':
          state = applyMusic(state)
          return true
        default:
          return false
      }
    })

  // The master gain follows the slider, so the mix panel's two columns are
  // driven by the same value a real settings change would send.
  const syncMaster = (): Effect.Effect<void> => backend.setMasterGain(state.settings.master)

  enterFullScreen()
  onExit(leaveFullScreen)
  onResize(() => {
    Effect.runFork(draw())
  })
  onInputEnd(() => {
    leaveFullScreen()
    process.exit(0)
  })

  onKey((key) => {
    if (key === 'q' || key === 'ctrl-c' || key === 'escape') {
      leaveFullScreen()
      process.exit(0)
    }
    Effect.runFork(
      Effect.gen(function* () {
        if (yield* handled(key)) {
          yield* syncMaster()
          yield* draw()
        }
      }),
    )
  })

  yield* draw()
})

// `runPromise` rather than `runSync`: `unlock` goes through `resume()`, which
// is a Promise even in the fake, because it is a Promise in a browser and an
// adapter that could only be driven synchronously would be the wrong adapter.
void Effect.runPromise(program)

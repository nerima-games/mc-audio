/**
 * Every frame the soundboard can draw, as pure functions.
 *
 * A dev application, not shipped API.
 *
 * ---------------------------------------------------------------------------
 * WHAT A TERMINAL SOUNDBOARD CAN HONESTLY SHOW
 * ---------------------------------------------------------------------------
 *
 * It cannot make a noise. That is not a limitation to be worked around, it is
 * the fact the whole design has to start from — so this file draws only things
 * that are TRUE WITHOUT SOUND, and `apps/preview-soundboard/README.md` states
 * the ones that are not.
 *
 * Four things are true without sound, and they are the four defects
 * `docs/design-notes.md` says this repository exists to prevent:
 *
 *  1. WHICH GATE STOPPED THE SOUND, and that the caption went out anyway. DN-1,
 *     rendered: the caption panel is populated by the REAL
 *     `makeSoundCueService`, and it stays populated while the graph panel shows
 *     the guard refusing. Three years of the reference implementation had this
 *     invariant tested for one gate out of three.
 *  2. THE GRAPH THAT WAS ACTUALLY BUILT, node by node and edge by edge, read
 *     back from the adapter's own calls rather than described a second time
 *     here. When the guard refuses, the panel shows the chain that WOULD have
 *     been built and marks where it stopped — because "nothing happened" is
 *     otherwise indistinguishable from "the preview is broken".
 *  3. THE GAIN ARITHMETIC, as numbers, with the per-cue gain and the master
 *     node's gain in two separate columns. DN-2's squared master is a wrong
 *     number, and a wrong number is legible. The reference carried that warning
 *     in two files and an assertion because somebody had already made the
 *     mistake once.
 *  4. THE ENVELOPE, sampled from `gainAt`. A curve that starts or ends anywhere
 *     but zero is the click that `audio-engine.ts` shipped, drawn.
 *
 * Every number below comes from `domain/`. Nothing here recomputes anything.
 */
import { Option } from 'effect'
import type { AudioAvailability } from '../../domain/backend-port'
import { visibleCaptions, type CaptionEvent } from '../../domain/caption'
import { cueDefinition, SOUND_CUE_IDS } from '../../domain/cue'
import { planCue, type CuePlan } from '../../domain/engine'
import { drivenFrequency, gainAt, toneEnvelope } from '../../domain/envelope'
import { MUSIC_TRACKS, musicTrackGain, MUSIC_ENVIRONMENTS } from '../../domain/music'
import { masterNodeGain, spatialise } from '../../domain/volume'
import type { WebAudioReport } from '../../domain/webaudio-adapter'
import type { FakeAudioLog } from '../../test/fake-webaudio'
import { bar, bipolarBar, INK, padEnd, padStart, sparkline, type Style } from './ansi'
import { cueContext, desiredMusic, selectedCue, type PreviewState } from './state'

export type Snapshot = {
  readonly state: PreviewState
  readonly availability: AudioAvailability
  readonly report: WebAudioReport
  /** What the adapter actually did to the device, recorded by the test double. */
  readonly log: FakeAudioLog
  readonly audioClockSecs: number
}

const RULE = (width: number): string => '-'.repeat(width)

const availabilityInk = (availability: AudioAvailability): string =>
  availability === 'ready' ? INK.ready : availability === 'locked' ? INK.locked : INK.unavailable

/**
 * The banner, and the one line that is always on screen.
 *
 * `availability` is asked of the ADAPTER every frame. It is the value
 * `docs/public-api.md` §3 says every caller must branch on, and putting it at
 * the top means no other panel can be read without it.
 */
export const renderHeader = (
  snapshot: Snapshot,
  style: Style,
  width: number,
): ReadonlyArray<string> => {
  const { report, state } = snapshot
  const context =
    report.contextState === null ? 'no context yet (lazy)' : `context ${report.contextState}`
  const source = report.constructorName ?? 'no constructor'
  const channels = report.contextState === null ? '' : report.stereo ? ' stereo' : ' MONO'

  return [
    style.bold(padEnd('mc-audio soundboard', width - 24)) +
      style.ink(availabilityInk(snapshot.availability), padStart(snapshot.availability, 24)),
    style.dim(`${source} | ${context}${channels}`),
    style.dim(
      `caption clock ${state.nowSecs.toFixed(2)}s | audio clock ${snapshot.audioClockSecs.toFixed(3)}s` +
        ` | audio ${state.enabled ? 'on' : 'MUTED'}` +
        ` | adapter refused ${report.refusedTones} cue(s)` +
        ` | unlock ${report.unlockAttempts} attempt(s), ${report.unlockRefusals} refused` +
        ` | interruptions ${report.spontaneousStateChanges}`,
    ),
    RULE(width),
  ]
}

/**
 * The cue roster.
 *
 * plan.md §3.6 asks for 「全キューを一覧から試聴」 — every cue listed and
 * auditionable. Auditioning in a terminal means seeing the plan the cue
 * produces, so each row carries the two numbers that decide whether it is heard
 * (`gain`, and whether a tone exists at all) and the caption it will emit.
 *
 * The `caption` column distinguishes an ABSENT caption from a SUPPRESSED one,
 * which the reference conflated: `inventoryOpen` and `inventoryClose` are
 * authored with `caption: null` on purpose (`domain/cue.ts`), and that is a
 * different silence from a cue whose caption was gated.
 */
export const renderBoard = (
  snapshot: Snapshot,
  style: Style,
  width: number,
): ReadonlyArray<string> => {
  const { state } = snapshot
  const selected = selectedCue(state)

  const rows = SOUND_CUE_IDS.map((cueId) => {
    const definition = cueDefinition(cueId)
    const plan: CuePlan = planCue(
      cueId,
      cueContext(state, snapshot.availability),
      definition.spatial ? { position: state.source } : undefined,
    )
    const marker = cueId === selected ? style.ink(INK.accent, '>') : ' '
    const gain = plan.tone === null ? '  --  ' : plan.tone.gain.toFixed(3)
    const caption =
      plan.caption === null ? style.dim('(uncaptioned)') : `"${plan.caption.text}"`
    const reason = plan.caption === null ? '' : plan.caption.reason

    return (
      `${marker} ${padEnd(cueId, 16)}` +
      `${padStart(gain, 7)}  ` +
      `${padEnd(definition.spatial ? 'spatial' : 'flat', 8)}` +
      `${padEnd(caption, 20)}` +
      style.ink(
        reason === 'audible' ? INK.ready : reason === '' ? INK.muted : INK.locked,
        reason,
      )
    )
  })

  return [
    style.bold('  cue                gain  placement  caption             reason'),
    ...rows,
    RULE(width),
    ...renderCaptionPanel(snapshot, style),
  ]
}

/**
 * The caption panel, and the reason this preview exists.
 *
 * `docs/testing.md` §3 asks for exactly one thing to be visible here:
 * 「オーディオがロックされた状態（初回訪問、まだクリックしていない）で字幕だけが
 * 出ることを目視できる」. Boot the preview without pressing `u`, play any cue,
 * and this panel fills while the graph panel shows the guard refusing.
 *
 * The rows come from `visibleCaptions`, so the expiry and the five-row cap and
 * the dedupe-by-text are the shipped ones — not a re-implementation that could
 * agree with the tests and disagree with the code.
 */
const renderCaptionPanel = (snapshot: Snapshot, style: Style): ReadonlyArray<string> => {
  const visible = visibleCaptions(snapshot.state.captions, snapshot.state.nowSecs)

  if (visible.length === 0) {
    return [
      style.bold('captions'),
      style.dim(
        snapshot.state.captions.length === 0
          ? '  (none yet — press enter to fire the selected cue)'
          : `  (all ${snapshot.state.captions.length} expired; they last 2.5s — press [ to rewind the caption clock)`,
      ),
    ]
  }

  return [
    style.bold(`captions  (${visible.length} visible of ${snapshot.state.captions.length} fired)`),
    ...visible.map((event: CaptionEvent) => {
      const age = (snapshot.state.nowSecs - event.atSecs).toFixed(2)
      const direction =
        event.pan === undefined ? '     ' : event.pan < 0 ? ' left' : event.pan > 0 ? 'right' : ' mid '
      return (
        `  ${padEnd(`"${event.text}"`, 22)}` +
        style.ink(event.reason === 'audible' ? INK.ready : INK.locked, padEnd(event.reason, 14)) +
        style.dim(`${direction}  ${age}s old`)
      )
    }),
  ]
}

const ENVELOPE_SAMPLES = 56

/**
 * The graph, and the envelope, and where the guard stopped.
 *
 * The node list and the edge list are read back from `FakeAudioLog` — the
 * adapter's own calls. That is deliberate and it is the difference between a
 * preview and a diagram: a diagram drawn here would keep looking right after
 * somebody changed the wiring.
 */
export const renderGraph = (
  snapshot: Snapshot,
  style: Style,
  width: number,
  ascii: boolean,
): ReadonlyArray<string> => {
  const { state, log, report } = snapshot
  const cueId = selectedCue(state)
  const definition = cueDefinition(cueId)
  const plan = planCue(
    cueId,
    cueContext(state, snapshot.availability),
    definition.spatial ? { position: state.source } : undefined,
  )

  const oscillators = log.created.filter((id) => id.startsWith('osc'))
  const edges =
    log.edges.length === 0
      ? [style.dim('  (nothing connected)')]
      : log.edges.map((edge) => `  ${padEnd(edge.from, 12)} -> ${edge.to}`)

  return [
    style.bold(`graph for ${cueId}`),
    ...renderRefusal(snapshot, plan, style),
    '',
    style.bold('nodes the adapter actually created'),
    log.created.length === 0
      ? style.dim('  (none — see above)')
      : `  ${log.created.join('  ')}`,
    style.bold('edges'),
    ...edges,
    style.dim(
      `  ${oscillators.length} oscillator(s) built, ${report.activeTones} still active, ` +
        `${log.disconnected.length} node(s) released`,
    ),
    RULE(width),
    ...renderEnvelope(plan, style, ascii),
  ]
}

/**
 * Where the guard stopped, spelled out.
 *
 * The `locked` case is the one worth drawing: the chain is shown with the point
 * of refusal marked, so that "no nodes exist" reads as a decision rather than as
 * an empty panel. The reference built this entire chain in exactly this state
 * and returned a handle for it.
 */
const renderRefusal = (
  snapshot: Snapshot,
  plan: CuePlan,
  style: Style,
): ReadonlyArray<string> => {
  // With no context there is nothing to have detected, so the channel count is
  // UNKNOWN rather than mono. Printing "mono: no createStereoPanner" here would
  // be the preview inventing a fact about a browser it never reached — the
  // exact class of confident-and-wrong reporting this repository is about.
  const chain =
    snapshot.report.contextState === null
      ? 'oscillator -> gain -> [panner?] -> master -> destination   (stereo unknown: no context was created)'
      : snapshot.report.stereo
        ? 'oscillator -> gain -> panner -> master -> destination'
        : 'oscillator -> gain -> master -> destination   (mono: no createStereoPanner)'

  if (plan.tone === null) {
    const gate = !snapshot.state.enabled
      ? {
          why: 'the player muted audio (settings gate)',
          fix: "press a to turn the player's audio switch back on",
        }
      : snapshot.availability === 'unavailable'
        ? {
            why: 'there is no audio backend at all',
            // Deliberately NOT "press u". A gesture cannot conjure a Web Audio
            // implementation, and offering one is how a UI ends up showing a
            // "click to enable sound" button that can never work — the
            // distinction `locked` exists to draw (domain/backend-port.ts).
            fix: 'no user gesture can fix this; restart without --absent, or press x if you closed the context',
          }
        : {
            why: 'the browser autoplay policy has not been satisfied',
            fix: 'press u — that is the user gesture',
          }

    return [
      style.ink(INK.locked, `  REFUSED before any node was built: ${gate.why}.`),
      style.dim(`  would have built:  ${chain}`),
      style.dim('  ...and built none of it. The caption still went out; see the board panel.'),
      style.dim(`  ${gate.fix}`),
    ]
  }

  return [style.ink(INK.ready, `  built:  ${chain}`)]
}

/**
 * The envelope, sampled from `gainAt`.
 *
 * The curve is the claim `domain/envelope.ts` makes, drawn: it starts at zero,
 * reaches the cue's gain, and returns to zero. A flat-topped block that begins
 * and ends at full height is what the reference did, and it is the click.
 *
 * Note the peak is printed as a number too. A curve alone cannot distinguish
 * 0.336 from 0.4, and that difference is the whole spatialisation panel.
 */
const renderEnvelope = (plan: CuePlan, style: Style, ascii: boolean): ReadonlyArray<string> => {
  if (plan.tone === null) {
    return [
      style.bold('envelope'),
      style.dim('  (no tone was planned, so there is no curve to draw)'),
    ]
  }

  const envelope = toneEnvelope(plan.tone, 0)
  const span = envelope.stopAtSecs ?? 0.1
  const values = Array.from({ length: ENVELOPE_SAMPLES }, (_unused, index) =>
    gainAt(envelope, (span * index) / (ENVELOPE_SAMPLES - 1)),
  )

  return [
    style.bold(`envelope  (${(span * 1000).toFixed(0)}ms, peak ${envelope.peakGain.toFixed(3)})`),
    `  ${sparkline(values, ascii, envelope.peakGain)}`,
    style.dim(
      `  0ms${' '.repeat(Math.max(0, ENVELOPE_SAMPLES - 12))}${(span * 1000).toFixed(0)}ms`,
    ),
    style.dim(
      `  frequency ${plan.tone.frequency.toFixed(2)}Hz requested, ` +
        `${drivenFrequency(plan.tone.frequency).toFixed(2)}Hz driven` +
        `${drivenFrequency(plan.tone.frequency) === plan.tone.frequency ? '' : '  <-- CLAMPED'}`,
    ),
  ]
}

/**
 * The mix panel: the arithmetic of `docs/design-notes.md` DN-2, as numbers.
 *
 * The two columns are the whole point. `per-cue gain` must NOT move when master
 * moves; `master node` must. A build that multiplied master in twice would show
 * the left column changing with the master slider, which is a thing you can see
 * in one keystroke and cannot hear without a reference recording.
 */
export const renderMix = (
  snapshot: Snapshot,
  style: Style,
  width: number,
): ReadonlyArray<string> => {
  const { state } = snapshot
  const cueId = selectedCue(state)
  const definition = cueDefinition(cueId)
  const plan = planCue(
    cueId,
    cueContext(state, snapshot.availability),
    definition.spatial ? { position: state.source } : undefined,
  )
  const spatialisation = spatialise(state.listener, state.source)
  const distance = Math.hypot(
    state.source.x - state.listener.x,
    state.source.y - state.listener.y,
    state.source.z - state.listener.z,
  )

  const slider = (name: string, value: number, keys: string): string =>
    `  ${padEnd(name, 8)}${bar(value, 24)}  ${value.toFixed(2)}  ${style.dim(keys)}`

  return [
    style.bold('volume categories'),
    slider('master', state.settings.master, '1 / !'),
    slider('sfx', state.settings.sfx, '2 / @'),
    slider('music', state.settings.music, '3 / #'),
    '',
    style.bold(`gain for ${cueId}`),
    `  ${padEnd('per-cue gain', 20)}${padStart(plan.tone === null ? '--' : plan.tone.gain.toFixed(4), 8)}` +
      style.dim('   must NOT change when master changes'),
    `  ${padEnd('master node gain', 20)}${padStart(masterNodeGain(state.settings).toFixed(4), 8)}` +
      style.dim('   the only place master becomes a number'),
    `  ${padEnd('what a speaker gets', 20)}${padStart(
      plan.tone === null ? '--' : (plan.tone.gain * masterNodeGain(state.settings)).toFixed(4),
      8,
    )}` + style.dim('   the product, applied once'),
    '',
    style.bold('spatialisation'),
    `  ${padEnd('distance', 20)}${padStart(distance.toFixed(2), 8)} blocks` +
      style.dim('   attenuation is 1/(1 + d/12)'),
    `  ${padEnd('attenuation', 20)}${padStart(spatialisation.gain.toFixed(4), 8)}`,
    `  ${padEnd('pan', 20)}${padStart(spatialisation.pan.toFixed(4), 8)}`,
    `  ${' '.repeat(20)}${bipolarBar(spatialisation.pan, 12)}  ${style.dim('left    centre    right')}`,
    style.dim(`  source x=${state.source.x}  (, and . to move it)`),
    RULE(width),
  ]
}

/**
 * The BGM state machine, with the NO-OP made visible.
 *
 * `docs/design-notes.md` DN-5: the same environment already playing must
 * produce no action at all, or the track restarts every frame — a silent bug
 * that manifests as a permanently retriggering note. A panel that showed only
 * the active track would look identical either way, so the plan itself is
 * printed.
 */
export const renderMusic = (
  snapshot: Snapshot,
  style: Style,
  width: number,
): ReadonlyArray<string> => {
  const { state } = snapshot
  const desired = desiredMusic(state)

  const plan = state.lastMusicPlan
  const planLine =
    plan === null
      ? style.dim('  (press m to run the state machine)')
      : `  stop active track: ${plan.shouldStopActiveTrack}` +
        `   play: ${Option.match(plan.environmentToPlay, {
          onNone: () => style.ink(INK.accent, 'nothing'),
          onSome: (environment) => environment,
        })}`

  return [
    style.bold('environment'),
    `  ${padEnd('player Y', 18)}${padStart(String(state.playerY), 6)}   ${style.dim('w / s to move')}`,
    `  ${padEnd('cave threshold', 18)}${padStart('40', 6)}   ${style.dim('strictly below is cave — DN-4')}`,
    `  ${padEnd('night', 18)}${padStart(String(state.isNight), 6)}   ${style.dim('n to toggle')}`,
    `  ${padEnd('resolves to', 18)}${padStart(desired, 6)}`,
    '',
    style.bold('state machine'),
    `  ${padEnd('active track', 18)}${padStart(
      Option.match(state.activeMusic, { onNone: () => 'none', onSome: (value) => value }),
      6,
    )}`,
    `  ${padEnd('desired', 18)}${padStart(desired, 6)}`,
    planLine,
    '',
    style.bold('tracks'),
    ...MUSIC_ENVIRONMENTS.map((environment) => {
      const track = MUSIC_TRACKS[environment]
      const gain = musicTrackGain(environment, state.settings.music)
      const active = Option.getOrNull(state.activeMusic) === environment
      return (
        `  ${active ? style.ink(INK.ready, '*') : ' '} ${padEnd(environment, 8)}` +
        `${padStart(track.frequency.toFixed(2), 8)}Hz  base ${track.baseGain.toFixed(2)}` +
        `  gain ${gain.toFixed(4)}  ${bar(gain, 16)}`
      )
    }),
    style.dim('  every track is a sine wave: ToneRequest has no `wave` field. See DEFAULT_TONE_WAVE.'),
    RULE(width),
  ]
}

export const renderNotes = (snapshot: Snapshot, style: Style): ReadonlyArray<string> =>
  snapshot.state.notes.length === 0
    ? []
    : [style.bold('log'), ...snapshot.state.notes.map((line) => style.dim(`  ${line}`))]

export const KEY_HELP = [
  'up/down select cue   enter play   tab panel   1!2@3# volumes   , . move source',
  'u unlock (user gesture)   a mute   i interrupt (iOS call)   x close context',
  '[ ] caption clock   - + audio clock   w s player Y   n night   m run music machine   q quit',
] as const

export const renderFrame = (
  snapshot: Snapshot,
  style: Style,
  width: number,
  ascii: boolean,
): ReadonlyArray<string> => {
  const body =
    snapshot.state.panel === 'board'
      ? renderBoard(snapshot, style, width)
      : snapshot.state.panel === 'graph'
        ? renderGraph(snapshot, style, width, ascii)
        : snapshot.state.panel === 'mix'
          ? renderMix(snapshot, style, width)
          : renderMusic(snapshot, style, width)

  return [
    ...renderHeader(snapshot, style, width),
    style.dim(`panel: ${snapshot.state.panel}   (tab to cycle)`),
    '',
    ...body,
    ...renderNotes(snapshot, style),
    '',
    ...KEY_HELP.map((line) => style.dim(line)),
    style.dim('NOTHING HERE MAKES A SOUND. See apps/preview-soundboard/README.md.'),
  ]
}

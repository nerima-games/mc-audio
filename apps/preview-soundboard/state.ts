/**
 * The soundboard's state, as pure transitions.
 *
 * A dev application, not shipped API.
 *
 * No Effect, no I/O, no clock. Every function here takes a state and returns a
 * state, so the whole interaction model is exercisable from a test without a
 * terminal, an adapter, or a fake — and `test/soundboard-preview.test.ts` does.
 *
 * What this file does NOT own: the audio. There is no mirror of `planCue` here,
 * no second copy of the gain arithmetic, and no re-description of what the
 * adapter would build. `main.ts` runs the REAL `makeSoundCueService` against
 * the REAL adapter and the same test double the tests use, and this state holds
 * only what the player is pointing at and what came back. A preview that
 * recomputed the answer it was previewing would be able to draw a graph the
 * adapter never built.
 */
import { Option } from 'effect'
import type { CaptionEvent } from '../../domain/caption'
import { SOUND_CUE_IDS, type SoundCueId } from '../../domain/cue'
import type { CueContext } from '../../domain/engine'
import {
  DEFAULT_CAVE_THRESHOLD_Y,
  resolveMusicEnvironment,
  resolveMusicPlan,
  type MusicEnvironment,
  type MusicPlan,
} from '../../domain/music'
import {
  DEFAULT_VOLUME_SETTINGS,
  type Vec3,
  type VolumeCategory,
  type VolumeSettings,
} from '../../domain/volume'
import type { AudioAvailability } from '../../domain/backend-port'

export const PANELS = ['board', 'graph', 'mix', 'music'] as const

export type PanelName = (typeof PANELS)[number]

export const isPanelName = (value: string): value is PanelName =>
  (PANELS as ReadonlyArray<string>).includes(value)

export type PreviewState = {
  readonly panel: PanelName
  readonly cueIndex: number
  readonly settings: VolumeSettings
  /** The player's audio switch. Distinct from availability — see `domain/engine.ts`. */
  readonly enabled: boolean
  readonly listener: Vec3
  readonly source: Vec3
  /**
   * The CAPTION clock, in seconds. Advanced only by a keystroke.
   *
   * This is the `nowSecs` that `makeSoundCueService` takes and that
   * `visibleCaptions` ages events against. It is NOT the audio clock; see
   * `terminal.ts` on why the preview keeps two.
   */
  readonly nowSecs: number
  readonly playerY: number
  readonly isNight: boolean
  readonly activeMusic: Option.Option<MusicEnvironment>
  /** The last plan `resolveMusicPlan` produced, kept so a no-op is VISIBLE. */
  readonly lastMusicPlan: MusicPlan | null
  readonly captions: ReadonlyArray<CaptionEvent>
  /** What the last action did, in one line. Newest first. */
  readonly notes: ReadonlyArray<string>
}

export const INITIAL_STATE: PreviewState = {
  panel: 'board',
  cueIndex: 0,
  settings: DEFAULT_VOLUME_SETTINGS,
  enabled: true,
  listener: { x: 0, y: 64, z: 0 },
  source: { x: 4, y: 64, z: 0 },
  nowSecs: 0,
  playerY: 64,
  isNight: false,
  activeMusic: Option.none(),
  lastMusicPlan: null,
  captions: [],
  notes: [],
}

const MAX_NOTES = 6

export const note = (state: PreviewState, text: string): PreviewState => ({
  ...state,
  notes: [text, ...state.notes].slice(0, MAX_NOTES),
})

export const selectedCue = (state: PreviewState): SoundCueId =>
  SOUND_CUE_IDS[state.cueIndex] ?? SOUND_CUE_IDS[0]

export const moveCursor = (state: PreviewState, delta: number): PreviewState => {
  const count = SOUND_CUE_IDS.length
  return { ...state, cueIndex: (state.cueIndex + delta + count) % count }
}

export const selectPanel = (state: PreviewState, panel: PanelName): PreviewState => ({
  ...state,
  panel,
})

export const cyclePanel = (state: PreviewState): PreviewState =>
  selectPanel(state, PANELS[(PANELS.indexOf(state.panel) + 1) % PANELS.length] ?? 'board')

/**
 * The `CueContext` the real service is driven with.
 *
 * `availability` is passed in rather than stored, because it belongs to the
 * adapter and asking the adapter is the only honest way to know it. A preview
 * that kept its own copy could show `ready` for a context the guard had
 * refused, which is the exact class of bug this whole repository is about.
 */
export const cueContext = (
  state: PreviewState,
  availability: AudioAvailability,
): CueContext => ({
  settings: state.settings,
  enabled: state.enabled,
  availability,
  listener: state.listener,
})

export const adjustVolume = (
  state: PreviewState,
  category: VolumeCategory,
  delta: number,
): PreviewState => {
  const next = Math.min(1, Math.max(0, Number((state.settings[category] + delta).toFixed(2))))
  return {
    ...state,
    settings: { ...state.settings, [category]: next },
  }
}

export const toggleEnabled = (state: PreviewState): PreviewState => ({
  ...state,
  enabled: !state.enabled,
})

/** Move the sound source on the X axis, which is the axis pan is derived from. */
export const moveSource = (state: PreviewState, deltaX: number): PreviewState => ({
  ...state,
  source: { ...state.source, x: Number((state.source.x + deltaX).toFixed(2)) },
})

export const advanceCaptionClock = (state: PreviewState, seconds: number): PreviewState => ({
  ...state,
  nowSecs: Number((state.nowSecs + seconds).toFixed(3)),
})

export const withCaptions = (
  state: PreviewState,
  captions: ReadonlyArray<CaptionEvent>,
): PreviewState => ({ ...state, captions })

export const adjustPlayerY = (state: PreviewState, delta: number): PreviewState => ({
  ...state,
  playerY: state.playerY + delta,
})

export const toggleNight = (state: PreviewState): PreviewState => ({
  ...state,
  isNight: !state.isNight,
})

export const desiredMusic = (state: PreviewState): MusicEnvironment =>
  resolveMusicEnvironment({
    playerY: state.playerY,
    isNight: state.isNight,
    caveThresholdY: DEFAULT_CAVE_THRESHOLD_Y,
  })

/**
 * Apply the BGM state machine once, and KEEP THE PLAN.
 *
 * Keeping it is the point. `docs/design-notes.md` DN-5 is about the case where
 * the right answer is to do nothing — the same environment already playing must
 * NOT restart the track — and "nothing happened" is invisible unless something
 * says so. A preview that only showed the active track would look identical
 * whether the machine was correct or was restarting the track on every frame.
 */
export const applyMusic = (state: PreviewState): PreviewState => {
  const desired = desiredMusic(state)
  const plan = resolveMusicPlan({
    enabled: state.enabled,
    active: state.activeMusic,
    desired,
  })

  const active = Option.isSome(plan.environmentToPlay)
    ? plan.environmentToPlay
    : plan.shouldStopActiveTrack
      ? Option.none<MusicEnvironment>()
      : state.activeMusic

  const description = Option.isSome(plan.environmentToPlay)
    ? `${plan.shouldStopActiveTrack ? 'stop then ' : ''}play ${plan.environmentToPlay.value}`
    : plan.shouldStopActiveTrack
      ? 'stop, play nothing'
      : 'NO ACTION — already playing the desired track'

  return note({ ...state, activeMusic: active, lastMusicPlan: plan }, `music: ${description}`)
}

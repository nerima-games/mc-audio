/**
 * The only impure module in the preview.
 *
 * A dev application, not shipped API.
 *
 * Everything else here — the state, every view, the option parser — is a pure
 * function of its arguments. Node's stdio lives behind this file so the
 * boundary is visible rather than sprinkled, which is the same reason `domain/`
 * keeps `AudioContext` behind `domain/webaudio-surface.ts` and takes `nowSecs`
 * as a parameter.
 *
 * ---------------------------------------------------------------------------
 * No clock, in the repository that would most like one
 * ---------------------------------------------------------------------------
 *
 * `pnpm check:deps` bans `Date.now()`, `new Date()` and `performance.now()`
 * (`docs/architecture.md` §2, rule 7), and audio is where somebody reaches for
 * one: a soundboard wants to age captions and animate an envelope, and both are
 * about time passing.
 *
 * Neither is done with a wall clock. There are TWO virtual clocks here and they
 * are deliberately separate, because they are separate in the real system:
 *
 *   - The CAPTION clock is `nowSecs` in `state.ts`, advanced by a keystroke. It
 *     is the `nowSecs` that `makeSoundCueService` takes, and it is what
 *     `visibleCaptions` ages events against. A preview that expired captions on
 *     a wall clock would be exercising a different module than the one that
 *     ships.
 *   - The AUDIO clock is `FakeAudioContext.currentTime`, advanced by
 *     `advance()`. That is `AudioContext.currentTime` — the device's own clock,
 *     which is what the adapter schedules against and which is why the ban is
 *     honoured with no `mc-kernel-allow-time-source` escape hatch anywhere in
 *     this repository.
 *
 * Keeping them separate means a caption can be aged out while a tone is still
 * sounding, and vice versa, which is a real state that a single clock would
 * hide. The side effect is that a 70 ms cue can be stepped through in 5 ms
 * increments without waiting 70 ms.
 *
 * Adapted from mx-ui's `apps/preview-screens/terminal.ts`.
 */
import { ESC } from './ansi'

export type Screen = {
  readonly columns: number
  readonly rows: number
}

const FALLBACK_SCREEN: Screen = { columns: 100, rows: 40 }

export const screenSize = (): Screen => ({
  columns: process.stdout.columns ?? FALLBACK_SCREEN.columns,
  rows: process.stdout.rows ?? FALLBACK_SCREEN.rows,
})

export const NEWLINE: string = String.fromCharCode(10)

export const write = (text: string): void => {
  process.stdout.write(text)
}

export const writeLine = (text = ''): void => {
  process.stdout.write(`${text}${NEWLINE}`)
}

export const isInteractive = (): boolean =>
  process.stdin.isTTY === true && process.stdout.isTTY === true

const ENTER_ALT_SCREEN = `${ESC}[?1049h`
const LEAVE_ALT_SCREEN = `${ESC}[?1049l`
const HIDE_CURSOR = `${ESC}[?25l`
const SHOW_CURSOR = `${ESC}[?25h`
const HOME = `${ESC}[H`
const CLEAR_TO_END = `${ESC}[J`
const CLEAR_TO_LINE_END = `${ESC}[K`

export const enterFullScreen = (): void => {
  write(`${ENTER_ALT_SCREEN}${HIDE_CURSOR}${HOME}${CLEAR_TO_END}`)
  if (typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true)
  }
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
}

export const leaveFullScreen = (): void => {
  if (typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(false)
  }
  process.stdin.pause()
  write(`${SHOW_CURSOR}${LEAVE_ALT_SCREEN}`)
}

/**
 * Redraw in place rather than clearing first, so the frame does not flash.
 * Each line is cleared to its own end, which is what stops a short line from
 * leaving the tail of the previous, longer one behind it.
 */
export const paintFrame = (lines: ReadonlyArray<string>): void => {
  write(HOME + lines.map((line) => line + CLEAR_TO_LINE_END).join(NEWLINE) + CLEAR_TO_END)
}

const ETX = String.fromCharCode(3)
const CARRIAGE_RETURN = String.fromCharCode(13)

const KEY_NAMES: ReadonlyMap<string, string> = new Map([
  [`${ESC}[A`, 'up'],
  [`${ESC}[B`, 'down'],
  [`${ESC}[C`, 'right'],
  [`${ESC}[D`, 'left'],
  [ESC, 'escape'],
  [ETX, 'ctrl-c'],
  [CARRIAGE_RETURN, 'enter'],
  [NEWLINE, 'enter'],
  ['\t', 'tab'],
])

const ARROWS: ReadonlyMap<string, string> = new Map([
  ['A', 'up'],
  ['B', 'down'],
  ['C', 'right'],
  ['D', 'left'],
])

/**
 * Split one stdin chunk into individual keys.
 *
 * A `data` event is a chunk of BYTES, not a keystroke. Holding a key and
 * pasting both deliver several at once, and an arrow key is three bytes that
 * must stay together.
 */
export const decodeKeys = (chunk: string): ReadonlyArray<string> => {
  const keys: Array<string> = []
  let index = 0

  while (index < chunk.length) {
    const character = chunk.charAt(index)

    if (character === ESC && chunk.charAt(index + 1) === '[') {
      const arrow = ARROWS.get(chunk.charAt(index + 2))
      if (arrow !== undefined) {
        keys.push(arrow)
        index += 3
        continue
      }
    }

    keys.push(KEY_NAMES.get(character) ?? character)
    index += 1
  }

  return keys
}

export const onKey = (handler: (key: string) => void): void => {
  process.stdin.on('data', (chunk: string | Buffer) => {
    for (const key of decodeKeys(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))) {
      handler(key)
    }
  })
}

/** End of input. Without this the app waits forever on a closed stdin. */
export const onInputEnd = (handler: () => void): void => {
  process.stdin.on('end', handler)
}

export const onResize = (handler: () => void): void => {
  process.stdout.on('resize', handler)
}

export const onExit = (handler: () => void): void => {
  process.on('exit', handler)
  process.on('SIGINT', () => {
    handler()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    handler()
    process.exit(0)
  })
}

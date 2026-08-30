/**
 * Terminal styling, and the bar charts the soundboard is mostly made of.
 *
 * A dev application, not shipped API.
 *
 * Pure: every function here takes values and returns a string. Nothing touches
 * `process`, so every frame this preview can draw is producible — and
 * assertable — without a terminal. `test/soundboard-preview.test.ts` does
 * exactly that.
 *
 * Adapted from mx-ui's `apps/preview-screens/ansi.ts`. The two are deliberately
 * separate copies rather than a shared package: these are independent
 * repositories, and a shared preview harness would be a cross-repository
 * dependency created for the convenience of dev tooling — exactly the edge
 * `pnpm check:deps` refuses (`docs/architecture.md` §2).
 */

export const ESC: string = String.fromCharCode(27)

const SGR = (code: string) => `${ESC}[${code}m`

const RESET = SGR('0')

export type Style = {
  readonly ink: (code: string, text: string) => string
  readonly bold: (text: string) => string
  readonly dim: (text: string) => string
}

/**
 * `plain` drops every escape sequence.
 *
 * `--ascii` selects it, and the reason is the same one every preview in this
 * organisation gives: a frame that can be piped, diffed and pasted into an
 * issue is worth more than a pretty one. A screenshot cannot be grepped.
 */
export const makeStyle = (colour: boolean): Style =>
  colour
    ? {
        ink: (code, text) => `${SGR(code)}${text}${RESET}`,
        bold: (text) => `${SGR('1')}${text}${RESET}`,
        dim: (text) => `${SGR('2')}${text}${RESET}`,
      }
    : {
        ink: (_code, text) => text,
        bold: (text) => text,
        dim: (text) => text,
      }

export const INK = {
  ready: '32',
  locked: '33',
  unavailable: '31',
  accent: '36',
  muted: '90',
} as const

/** Printable width, ignoring escape sequences. */
export const visibleLength = (text: string): number => {
  let width = 0
  let index = 0
  while (index < text.length) {
    if (text.charAt(index) === ESC) {
      const end = text.indexOf('m', index)
      index = end === -1 ? text.length : end + 1
      continue
    }
    width += 1
    index += 1
  }
  return width
}

export const padEnd = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - visibleLength(text)))

export const padStart = (text: string, width: number): string =>
  ' '.repeat(Math.max(0, width - visibleLength(text))) + text

/**
 * A horizontal bar for a value in [0, 1].
 *
 * Shows the NUMBER as well as the bar, always. A bar alone cannot distinguish
 * 0.24 from 0.28 — which is exactly the difference between the night and cave
 * BGM gains — and the whole point of the volume screen is that a squared master
 * (`docs/design-notes.md` DN-2) is a visible arithmetic error rather than a
 * vague "sounds quiet".
 */
export const bar = (value: number, width: number, filled = '#', empty = '.'): string => {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  const cells = Math.round(clamped * width)
  return filled.repeat(cells) + empty.repeat(Math.max(0, width - cells))
}

/**
 * A bar for a value in [-1, 1], with a marked centre. Used for pan.
 *
 * The centre tick is why this is not `bar` with a shifted input: "dead centre"
 * and "very slightly left" have to be distinguishable, because a
 * non-spatialised cue reporting a pan of exactly 0 and a spatialised cue that
 * happens to be centred mean different things (`domain/engine.ts` omits `pan`
 * for the former rather than reporting a misleading zero).
 */
export const bipolarBar = (value: number, halfWidth: number): string => {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0
  const cells = Array.from({ length: halfWidth * 2 + 1 }, () => '-')
  cells[halfWidth] = '|'
  const position = halfWidth + Math.round(clamped * halfWidth)
  cells[Math.min(cells.length - 1, Math.max(0, position))] = 'O'
  return cells.join('')
}

/**
 * Eight levels of vertical block, for the envelope curve.
 *
 * `--ascii` swaps them for digits, which stay readable in a pasted frame and,
 * unlike the blocks, survive a terminal without the glyphs. The shape is the
 * information either way.
 */
const BLOCK_LEVELS = ['_', '▁', '▂', '▃', '▅', '▆', '▇', '█']
const ASCII_LEVELS = ['_', '1', '2', '3', '4', '5', '6', '8']

export const sparkline = (
  values: ReadonlyArray<number>,
  ascii: boolean,
  peak: number,
): string => {
  const levels = ascii ? ASCII_LEVELS : BLOCK_LEVELS
  const scale = peak > 0 ? peak : 1
  return values
    .map((value) => {
      const normalised = Math.min(1, Math.max(0, value / scale))
      const index = Math.min(levels.length - 1, Math.round(normalised * (levels.length - 1)))
      return levels[index] ?? levels[0] ?? '_'
    })
    .join('')
}

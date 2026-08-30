/**
 * Command-line options for the soundboard.
 *
 * A dev application, not shipped API.
 *
 * Pure: `parseArguments` reads an array and returns a value. It never touches
 * `process`, so the whole option surface is exercisable without launching a
 * terminal UI.
 *
 * The flags that matter are the ones that put the preview into a state a real
 * browser would be in and a developer's machine usually is not: `--absent` is
 * Node or SSR, and `--refuse` is a browser that will not honour the gesture.
 * Those are the two configurations the reference implementation could not run
 * at all, and the ones its `audio-engine.ts` had zero tests for
 * (`docs/porting.md` §6).
 *
 * Adapted from mx-ui's `apps/preview-screens/options.ts`, including its two
 * hard-won behaviours: a literal `--` is accepted and ignored (pnpm 9 forwards
 * one when somebody writes `pnpm preview -- --once` out of npm habit), and an
 * unknown flag is an ERROR rather than a silent no-op.
 */
import { isPanelName, type PanelName } from './state'

export type PreviewOptions = {
  readonly panel: PanelName
  /** Start with the context already unlocked, i.e. skip the user gesture. */
  readonly unlocked: boolean
  /** `resume()` never succeeds: a browser that will not honour the gesture. */
  readonly refuse: boolean
  /** No Web Audio at all: Node, SSR, a browser without it. */
  readonly absent: boolean
  /** Fire this cue before drawing, so `--once` can show a populated frame. */
  readonly play: string | undefined
  readonly once: boolean
  readonly ascii: boolean
  readonly help: boolean
  readonly width: number | undefined
  readonly errors: ReadonlyArray<string>
}

const DEFAULTS = {
  panel: 'board',
  unlocked: false,
  refuse: false,
  absent: false,
  play: undefined,
  once: false,
  ascii: false,
  help: false,
  width: undefined,
  errors: [],
} satisfies PreviewOptions

type Accumulator = {
  -readonly [Key in keyof PreviewOptions]: PreviewOptions[Key]
}

export const USAGE = [
  'pnpm preview [options]',
  '',
  '  --panel NAME    board | graph | mix | music        (default: board)',
  '  --play CUE      fire a cue before drawing, e.g. --play blockBreak',
  '  --unlocked      start with the AudioContext already running',
  '  --refuse        resume() never succeeds: the autoplay policy that never yields',
  '  --absent        no Web Audio at all: Node, SSR, a browser without it',
  '  --once          draw one frame and exit (pipeable)',
  '  --ascii         no colour, no block glyphs (pipeable, diffable)',
  '  --width N       frame width',
  '  --help',
  '',
  'Nothing here makes a sound. See apps/preview-soundboard/README.md for what',
  'this preview can and cannot tell you.',
] as const

export const parseArguments = (argv: ReadonlyArray<string>): PreviewOptions => {
  const accumulator: Accumulator = { ...DEFAULTS }
  const queue = [...argv]

  const fail = (message: string): void => {
    accumulator.errors = [...accumulator.errors, message]
  }

  while (queue.length > 0) {
    const flag = queue.shift()
    if (flag === undefined || flag === '--') {
      continue
    }

    switch (flag) {
      case '--panel': {
        const value = queue.shift()
        if (value === undefined) {
          fail('--panel needs a value')
        } else if (!isPanelName(value)) {
          fail(`--panel: "${value}" is not one of board, graph, mix, music`)
        } else {
          accumulator.panel = value
        }
        break
      }
      case '--play': {
        const value = queue.shift()
        if (value === undefined) {
          fail('--play needs a cue id')
        } else {
          // Validated against the roster in `main.ts` rather than here, so that
          // this module stays a parser and the error message can list the real
          // roster without this file importing it.
          accumulator.play = value
        }
        break
      }
      case '--width': {
        const value = queue.shift()
        const parsed = value === undefined ? Number.NaN : Number(value)
        if (!Number.isFinite(parsed)) {
          fail(`--width: "${value ?? ''}" is not a number`)
        } else {
          accumulator.width = parsed
        }
        break
      }
      case '--unlocked':
        accumulator.unlocked = true
        break
      case '--refuse':
        accumulator.refuse = true
        break
      case '--absent':
        accumulator.absent = true
        break
      case '--once':
        accumulator.once = true
        break
      case '--ascii':
        accumulator.ascii = true
        break
      case '--help':
      case '-h':
        accumulator.help = true
        break
      default:
        fail(`unknown flag: ${flag}`)
    }
  }

  // `--unlocked` with a policy that refuses is a contradiction, and silently
  // preferring one would make a frame that cannot be explained from its own
  // command line.
  if (accumulator.unlocked && accumulator.refuse) {
    fail('--unlocked and --refuse contradict each other')
  }
  if (accumulator.unlocked && accumulator.absent) {
    fail('--unlocked and --absent contradict each other')
  }

  return accumulator
}

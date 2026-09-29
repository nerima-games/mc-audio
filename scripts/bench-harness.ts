/* oxlint-disable no-await-in-loop -- sequential iterations preserve benchmark workload and timing. */
/**
 * Benchmark measurement and baseline comparison.
 *
 * Adapted from mc-meshing's R-C5 benchmark harness. The source keeps the
 * warm-up, odd-sample median, and ratio-gate methodology; the workloads here
 * are audio cue lookup and mixer graph construction instead of meshing.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

const now = (): number => performance.now() // Mc-kernel-allow-time-source: benchmark harness

export type MeasureOptions = {
  readonly iterations: number
  readonly warmupIterations: number
  readonly runs: number
}

export const median = (samples: ReadonlyArray<number>): number => {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
}

export const measure = (run: () => void, options: MeasureOptions): number => {
  for (let index = 0; index < options.warmupIterations; index += 1) {
    run()
  }
  const samples: Array<number> = []
  for (let sample = 0; sample < options.runs; sample += 1) {
    const started = now()
    for (let index = 0; index < options.iterations; index += 1) {
      run()
    }
    samples.push((now() - started) / options.iterations)
  }
  return median(samples)
}

export const measureAsync = async (run: () => Promise<void>, options: MeasureOptions): Promise<number> => {
  for (let index = 0; index < options.warmupIterations; index += 1) {
    await run()
  }
  const samples: Array<number> = []
  for (let sample = 0; sample < options.runs; sample += 1) {
    const started = now()
    for (let index = 0; index < options.iterations; index += 1) {
      await run()
    }
    samples.push((now() - started) / options.iterations)
  }
  return median(samples)
}

export type Guard = {
  readonly name: string
  readonly fastLabel: string
  readonly slowLabel: string
  readonly fastMs: number
  readonly slowMs: number
}

export const guardRatio = (guard: Guard): number => guard.slowMs / guard.fastMs

export type Workload = {
  readonly name: string
  readonly msPerUnit: number
  readonly unit: string
  readonly detail?: string
}

export type Baseline = {
  readonly version: 1
  readonly recordedOn: string
  readonly note: string
  readonly guards: Readonly<Record<string, number>>
  readonly workloads: Readonly<Record<string, number>>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const decodeNumbers = (value: unknown, field: string): Readonly<Record<string, number>> => {
  if (!isRecord(value)) {
    throw new TypeError(`Invalid benchmark baseline: ${field} must be an object`)
  }
  const result: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new TypeError(`Invalid benchmark baseline: ${field}.${key} must be finite`)
    }
    result[key] = entry
  }
  return result
}

const decodeBaseline = (value: unknown): Baseline => {
  if (!isRecord(value) || value['version'] !== 1 || typeof value['recordedOn'] !== 'string' || typeof value['note'] !== 'string') {
    throw new TypeError('Invalid benchmark baseline: expected version 1 metadata')
  }
  return {
    guards: decodeNumbers(value['guards'], 'guards'),
    note: value['note'],
    recordedOn: value['recordedOn'],
    version: 1,
    workloads: decodeNumbers(value['workloads'], 'workloads'),
  }
}

export const readBaseline = async (filePath: string): Promise<Baseline | undefined> => {
  const raw = await readFile(filePath, 'utf8').catch(() => undefined)
  return raw === undefined ? undefined : decodeBaseline(JSON.parse(raw))
}

export const writeBaseline = async (filePath: string, baseline: Baseline): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(baseline, undefined, 2)}\n`, 'utf8')
}

export type CheckResult = {
  readonly label: string
  readonly kind: 'guard' | 'workload'
  readonly observed: number
  readonly baseline: number | undefined
  readonly status: 'ok' | 'regressed' | 'new'
}

export const checkGuards = (guards: ReadonlyArray<Guard>, baseline: Baseline | undefined, tolerance: number): ReadonlyArray<CheckResult> =>
  guards.map((guard) => {
    const observed = guardRatio(guard)
    const recorded = baseline?.guards[guard.name]
    return recorded === undefined
      ? { baseline: undefined, kind: 'guard' as const, label: guard.name, observed, status: 'new' as const }
      : { baseline: recorded, kind: 'guard' as const, label: guard.name, observed, status: observed >= recorded / tolerance ? 'ok' : 'regressed' }
  })

export const checkWorkloads = (workloads: ReadonlyArray<Workload>, yardstickMs: number, baseline: Baseline | undefined, tolerance: number): ReadonlyArray<CheckResult> =>
  workloads.map((workload) => {
    const observed = workload.msPerUnit / yardstickMs
    const recorded = baseline?.workloads[workload.name]
    return recorded === undefined
      ? { baseline: undefined, kind: 'workload' as const, label: workload.name, observed, status: 'new' as const }
      : { baseline: recorded, kind: 'workload' as const, label: workload.name, observed, status: observed <= recorded * tolerance ? 'ok' : 'regressed' }
  })

export const wantsBaselineUpdate = (argv: ReadonlyArray<string>): boolean => argv.includes('--update-baseline')

const numericFlag = (argv: ReadonlyArray<string>, name: string, fallback: number): number => {
  const flag = argv.find((argument) => argument.startsWith(`--${name}=`))
  const value = flag === undefined ? Number.NaN : Number.parseFloat(flag.slice(name.length + 3))
  return Number.isFinite(value) && value > 1 ? value : fallback
}

export const tolerancesFrom = (argv: ReadonlyArray<string>): { readonly guard: number; readonly workload: number } => ({
  guard: numericFlag(argv, 'guard-tolerance', 1.3),
  workload: numericFlag(argv, 'workload-tolerance', 2),
})

export const formatCheck = (result: CheckResult): string => {
  const against = result.baseline === undefined ? 'new' : `${(result.observed / result.baseline).toFixed(2)}x baseline`
  return `  ${result.status.toUpperCase().padEnd(9)} ${result.label.padEnd(42)} ${against}`
}

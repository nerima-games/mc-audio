/* oxlint-disable no-console -- CLI benchmark output is its purpose. */
/**
 * mc-audio benchmark.
 *
 * The measurement shape is adapted from mc-meshing's R-C5 harness. Its
 * registered/missing lookup workload and median baseline gates are retained;
 * the measured graph is this repository's production `buildToneGraph`.
 * This is a diagnostic benchmark, not part of the package API or CI.
 */
import { Effect } from 'effect'
import { cueDefinition, isSoundCueId, makeWebAudioBackend } from '../src/index.js'
import { makeFakeWebAudio } from '../test/fake-webaudio.js'
import { CUE_LOOKUP_IDS, REGISTERED_CUE_DEFINITIONS } from './bench-fixtures.js'
import {
  checkWorkloads,
  formatCheck,
  measure,
  measureAsync,
  readBaseline,
  tolerancesFrom,
  wantsBaselineUpdate,
  writeBaseline,
  type Baseline,
  type MeasureOptions,
  type Workload,
} from './bench-harness.js'

const BASELINE_PATH = new URL('./bench-baseline.json', import.meta.url).pathname
const RUNS = 7
let sink = 0

const options = (iterations: number, warmupIterations = iterations): MeasureOptions => ({ iterations, runs: RUNS, warmupIterations })

const lookupArm = (): void => {
  let hits = 0
  for (const cueId of CUE_LOOKUP_IDS) {
    if (isSoundCueId(cueId)) {
      hits += cueDefinition(cueId).frequency
    }
  }
  sink += hits
}

type MixerBench = {
  readonly run: () => Promise<void>
  readonly allocations: () => number
  readonly connections: () => number
}

const makeMixerBench = async (): Promise<MixerBench> => {
  const fake = makeFakeWebAudio()
  const backend = Effect.runSync(makeWebAudioBackend({
    global: fake.global,
    maxConcurrentTones: 100_000,
  }))
  await Effect.runPromise(backend.unlock)
  let index = 0
  return {
    run: async () => {
      const definition = REGISTERED_CUE_DEFINITIONS[index % REGISTERED_CUE_DEFINITIONS.length]
      if (definition === undefined) {
        throw new Error('Benchmark cue definitions are empty')
      }
      index += 1
      const request = {
        durationSecs: definition.durationSecs,
        frequency: definition.frequency,
        gain: definition.baseGain,
        loop: false,
        pan: definition.spatial ? -0.25 : 0,
        wave: definition.wave,
      } as const
      const playback = await Effect.runPromise(backend.playTone(request))
      if (playback.accepted) {
        sink += playback.id
      }
    },
    allocations: () => fake.context()?.log.created.length ?? 0,
    connections: () => fake.context()?.log.edges.length ?? 0,
  }
}

const main = async (): Promise<number> => {
  const tolerances = tolerancesFrom(process.argv)
  const lookupMs = measure(lookupArm, options(500, 1000)) / CUE_LOOKUP_IDS.length
  const mixer = await makeMixerBench()
  const mixerMs = await measureAsync(mixer.run, options(100, 200))
  const yardstickMs = measure(() => {
    let total = 0
    for (const cueId of CUE_LOOKUP_IDS) {
      total += cueId.length
    }
    sink += total
  }, options(500, 1000)) / CUE_LOOKUP_IDS.length
  const workloads: ReadonlyArray<Workload> = [
    { detail: `${String(CUE_LOOKUP_IDS.length)} fixed probes`, msPerUnit: lookupMs, name: 'cue-lookup/public-api', unit: 'probe' },
    { detail: `${String(mixer.allocations())} fake WebAudio nodes, ${String(mixer.connections())} fake graph edges after warmup`, msPerUnit: mixerMs, name: 'mixer/public-play-tone', unit: 'graph' },
  ]

  console.log('mc-audio benchmark — median of 7 timed runs after warmup')
  console.log(`  cue probes: ${String(CUE_LOOKUP_IDS.length)} (${String(REGISTERED_CUE_DEFINITIONS.length)} registered, ${String(CUE_LOOKUP_IDS.length - REGISTERED_CUE_DEFINITIONS.length)} missing)`)
  console.log(`  mixer allocations: ${String(mixer.allocations())} nodes, ${String(mixer.connections())} connections across warmup/timed runs`)
  console.log(`  hot-path fake graph report: ${String(mixer.allocations())} nodes, ${String(mixer.connections())} edges`)
  console.log(`  yardstick/cue-id-length-probe: ${yardstickMs.toFixed(6)} ms/probe`)
  for (const workload of workloads) {
    console.log(`  ${workload.name.padEnd(42)} ${workload.msPerUnit.toFixed(6)} ms/${workload.unit} (${workload.detail})`)
  }
  if (wantsBaselineUpdate(process.argv)) {
    const baseline: Baseline = {
      guards: {},
      note: 'Adapted from mc-meshing R-C5; workloads are same-process median measurements normalized by a fixed probe yardstick.',
      recordedOn: process.env['BENCH_MACHINE'] ?? 'unrecorded machine',
      version: 1,
      workloads: Object.fromEntries(workloads.map((workload) => [workload.name, Number((workload.msPerUnit / yardstickMs).toPrecision(4))])),
    }
    await writeBaseline(BASELINE_PATH, baseline)
    console.log(`baseline written to scripts/bench-baseline.json (sink ${String(sink)})`)
    return 0
  }

  const baseline = await readBaseline(BASELINE_PATH)
  const results = checkWorkloads(workloads, yardstickMs, baseline, tolerances.workload)
  for (const result of results) {
    console.log(formatCheck(result))
  }
  const regressed = results.filter((result) => result.status === 'regressed')
  console.log(regressed.length === 0 ? `no regressions (sink ${String(sink)})` : `${String(regressed.length)} regression(s)`)
  return regressed.length === 0 ? 0 : 1
}

process.exit(await main())

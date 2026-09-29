/* oxlint-disable no-console -- CLI benchmark output is its purpose. */
/**
 * mc-audio benchmark.
 *
 * The measurement shape is adapted from mc-meshing's R-C5 harness. Its
 * registered/missing lookup workload and median baseline gates are retained;
 * the measured graph is this repository's production `buildToneGraph`.
 * This is a diagnostic benchmark, not part of the package API or CI.
 */
import { buildToneGraph } from '../src/domain/webaudio-tone-graph.js'
import { toneEnvelope } from '../src/domain/envelope.js'
import type { GainSurface } from '../src/domain/webaudio-surface.js'
import { makeFakeWebAudio } from '../test/fake-webaudio.js'
import { CUE_LOOKUP_IDS, REGISTERED_CUE_DEFINITIONS, REGISTERED_CUE_IDS, lookupCue } from './bench-fixtures.js'
import {
  checkGuards,
  checkWorkloads,
  formatCheck,
  guardRatio,
  measure,
  readBaseline,
  tolerancesFrom,
  wantsBaselineUpdate,
  writeBaseline,
  type Baseline,
  type Guard,
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
    if (lookupCue(cueId) !== null) {
      hits += 1
    }
  }
  sink += hits
}

const registeredLookupArm = (): void => {
  let hits = 0
  for (const cueId of REGISTERED_CUE_IDS) {
    if (lookupCue(cueId) !== null) {
      hits += 1
    }
  }
  sink += hits
}

type MixerBench = {
  readonly run: () => void
  readonly allocations: () => number
  readonly connections: () => number
}

const makeMixerBench = (): MixerBench => {
  const fake = makeFakeWebAudio()
  const AudioContext = fake.global.AudioContext
  if (AudioContext === undefined) {
    throw new Error('Benchmark fake WebAudio context is unavailable')
  }
  const context = new AudioContext()
  const master: GainSurface = context.createGain()
  master.connect(context.destination)
  let index = 0
  return {
    run: () => {
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
      const graph = buildToneGraph({
        context,
        envelope: toneEnvelope(request, context.currentTime),
        master,
        playbackRate: 1,
        request,
        sampleBuffer: null,
        streamSource: null,
      })
      graph.source.start(context.currentTime)
      sink += graph.panner.pan.value
    },
    allocations: () => fake.context()?.log.created.length ?? 0,
    connections: () => fake.context()?.log.edges.length ?? 0,
  }
}

const main = async (): Promise<number> => {
  const tolerances = tolerancesFrom(process.argv)
  const lookupMs = measure(lookupArm, options(500, 1000))
  const registeredMs = measure(registeredLookupArm, options(500, 1000))
  const mixer = makeMixerBench()
  const mixerMs = measure(mixer.run, options(100, 200))
  const yardstickMs = measure(() => {
    let total = 0
    for (const cueId of CUE_LOOKUP_IDS) {
      total += cueId.length
    }
    sink += total
  }, options(500, 1000))

  const guards: ReadonlyArray<Guard> = [{
    name: 'cue-lookup/mixed-vs-registered-only',
    fastLabel: 'registered plus missing lookup',
    slowLabel: 'registered-only probe',
    fastMs: lookupMs,
    slowMs: registeredMs,
  }]
  const workloads: ReadonlyArray<Workload> = [
    { detail: `${String(mixer.allocations())} WebAudio nodes, ${String(mixer.connections())} edges after warmup`, msPerUnit: mixerMs, name: 'mixer/build-tone-graph', unit: 'graph' },
  ]

  console.log('mc-audio benchmark — median of 7 timed runs after warmup')
  console.log(`  cue probes: ${String(CUE_LOOKUP_IDS.length)} (${String(REGISTERED_CUE_DEFINITIONS.length)} registered, ${String(CUE_LOOKUP_IDS.length - REGISTERED_CUE_DEFINITIONS.length)} missing)`)
  console.log(`  mixer allocations: ${String(mixer.allocations())} nodes, ${String(mixer.connections())} connections across warmup/timed runs`)
  console.log(`  hot-path allocation report: lookup=${'none (prebuilt IDs; registry lookup only)'}, mixer='envelope + ActiveTone + 3 WebAudio nodes + 3 graph edges'`)
  console.log(`  yardstick/cue-id-length-pass: ${yardstickMs.toFixed(4)} ms/pass`)
  for (const workload of workloads) {
    console.log(`  ${workload.name.padEnd(42)} ${workload.msPerUnit.toFixed(4)} ms/${workload.unit} (${workload.detail})`)
  }
  for (const guard of guards) {
    console.log(`  guard ${guard.name}: ${guardRatio(guard).toFixed(2)}x`)
  }

  if (wantsBaselineUpdate(process.argv)) {
    const baseline: Baseline = {
      guards: Object.fromEntries(guards.map((guard) => [guard.name, Number(guardRatio(guard).toPrecision(4))])),
      note: 'Adapted from mc-meshing R-C5; guards are same-process A/B ratios and workloads are workload/yardstick ratios.',
      recordedOn: process.env['BENCH_MACHINE'] ?? 'unrecorded machine',
      version: 1,
      workloads: Object.fromEntries(workloads.map((workload) => [workload.name, Number((workload.msPerUnit / yardstickMs).toPrecision(4))])),
    }
    await writeBaseline(BASELINE_PATH, baseline)
    console.log(`baseline written to scripts/bench-baseline.json (sink ${String(sink)})`)
    return 0
  }

  const baseline = await readBaseline(BASELINE_PATH)
  const results = [...checkGuards(guards, baseline, tolerances.guard), ...checkWorkloads(workloads, yardstickMs, baseline, tolerances.workload)]
  for (const result of results) {
    console.log(formatCheck(result))
  }
  const regressed = results.filter((result) => result.status === 'regressed')
  console.log(regressed.length === 0 ? `no regressions (sink ${String(sink)})` : `${String(regressed.length)} regression(s)`)
  return regressed.length === 0 ? 0 : 1
}

process.exit(await main())

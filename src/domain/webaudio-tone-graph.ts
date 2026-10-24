import type {
  AudioBufferSurface,
  AudioContextSurface,
  AudioScheduledSourceSurface,
  GainSurface,
  OscillatorSurface,
  OscillatorWave,
  StereoPannerSurface,
} from './webaudio-surface.js'
import { type ToneEnvelope, drivenFrequency } from './envelope.js'
import type { AudioPlaybackRate } from './audio-brands.js'
import { Effect } from 'effect'
import type { ToneRequest } from './backend-port.js'
import { clampPan } from './volume.js'

export const DEFAULT_TONE_WAVE: OscillatorWave = 'sine'

export type ToneGraphFailure = {
  readonly _tag: 'ToneGraphFailure'
  readonly cause: unknown
  readonly soundId: ToneRequest['soundId'] | null
}

export type ActiveTone = {
  readonly source: AudioScheduledSourceSurface
  readonly gain: GainSurface
  readonly panner: StereoPannerSurface
  /** The curve used to schedule this tone, so stop can ramp from its current gain. */
  readonly envelope: ToneEnvelope
  /** A releasing tone remains in the graph until its scheduled source ends. */
  releasing: boolean
}

export type ToneGraphOptions = {
  readonly context: AudioContextSurface
  readonly master: GainSurface
  readonly request: ToneRequest
  readonly envelope: ToneEnvelope
  readonly sampleBuffer: AudioBufferSurface | null
  readonly playbackRate: AudioPlaybackRate
  readonly streamSource: AudioScheduledSourceSurface | null
}

type ToneSourceOptions = Pick<
  ToneGraphOptions,
  'context' | 'request' | 'sampleBuffer' | 'playbackRate' | 'streamSource'
>

const graphFailure = (options: ToneSourceOptions, cause: unknown): ToneGraphFailure => ({
  _tag: 'ToneGraphFailure',
  cause,
  soundId: options.request.soundId ?? null,
})

const createSampleSource = ({
  context,
  request,
  sampleBuffer,
  playbackRate,
}: ToneSourceOptions): Effect.Effect<AudioScheduledSourceSurface | null, ToneGraphFailure> => {
  const { createBufferSource } = context
  if (sampleBuffer === null || typeof createBufferSource !== 'function') {
    return Effect.succeed(null)
  }
  return Effect.try({
    catch: (cause) => graphFailure({ context, playbackRate, request, sampleBuffer, streamSource: null }, cause),
    try: () => {
      const bufferSource = createBufferSource.call(context)
      bufferSource.buffer = sampleBuffer
      bufferSource.loop = request.loop
      bufferSource.playbackRate.value = playbackRate
      return bufferSource
    },
  }).pipe(Effect.catch(() => Effect.succeed(null)))
}

const createStreamSource = ({ streamSource, request, context, sampleBuffer, playbackRate }: ToneSourceOptions): Effect.Effect<AudioScheduledSourceSurface, ToneGraphFailure> => {
  if (streamSource === null) {
    return Effect.fail(graphFailure({ context, playbackRate, request, sampleBuffer, streamSource }, 'A streaming source is required for a streaming tone request'))
  }
  return Effect.succeed(streamSource)
}

const createOscillatorSource = ({ context, request, sampleBuffer, playbackRate, streamSource }: ToneSourceOptions): Effect.Effect<OscillatorSurface, ToneGraphFailure> =>
  Effect.try({
    catch: (cause) => graphFailure({ context, playbackRate, request, sampleBuffer, streamSource }, cause),
    try: () => {
      const oscillator = context.createOscillator()
      oscillator.type = request.wave ?? DEFAULT_TONE_WAVE
      oscillator.frequency.value = drivenFrequency(request.frequency)
      return oscillator
    },
  })

const createStreamingSource = (options: ToneSourceOptions): Effect.Effect<AudioScheduledSourceSurface, ToneGraphFailure> => {
  if (options.streamSource !== null) {
    return createStreamSource(options)
  }
  return Effect.flatMap(createSampleSource(options), (sampleSource) => {
    if (sampleSource === null) {
      return createStreamSource(options)
    }
    return Effect.succeed(sampleSource)
  })
}

const createToneSource = (options: ToneSourceOptions): Effect.Effect<AudioScheduledSourceSurface, ToneGraphFailure> => {
  if (options.request.stream === true) {
    return createStreamingSource(options)
  }
  return Effect.flatMap(createSampleSource(options), (sampleSource) => {
    if (sampleSource !== null) {
      return Effect.succeed(sampleSource)
    }
    if (options.request.sampleOnly === true) {
      return Effect.fail(graphFailure(options, `No sample source is available for ${options.request.soundId ?? 'the requested audio'}`))
    }
    return createOscillatorSource(options)
  })
}

const scheduleEnvelope = (gain: GainSurface, envelope: ToneEnvelope): void => {
  for (const point of envelope.points) {
    if (point.kind === 'set') {
      gain.gain.setValueAtTime(point.gain, point.atSecs)
    } else {
      gain.gain.linearRampToValueAtTime(point.gain, point.atSecs)
    }
  }
}

type ToneConnectionOptions = Pick<ToneGraphOptions, 'context' | 'master' | 'request'> & {
  readonly gain: GainSurface
  readonly source: AudioScheduledSourceSurface
}

type OutputConnectionOptions = Pick<ToneConnectionOptions, 'gain' | 'master' | 'request'> & {
  readonly panner: StereoPannerSurface
}

const disconnectNodes = (
  nodes: ReadonlyArray<AudioScheduledSourceSurface | GainSurface | StereoPannerSurface | null>,
): Effect.Effect<void> =>
  Effect.forEach(nodes, (node) =>
    Effect.try({
      catch: (cause) => cause,
      try: () => node?.disconnect(),
    }).pipe(Effect.catch(() => Effect.void)),
  ).pipe(Effect.asVoid)

const connectOutput = ({ gain, master, panner, request }: OutputConnectionOptions): void => {
  panner.pan.value = clampPan(request.pan)
  gain.connect(panner)
  panner.connect(master)
}

const connectToneNodes = ({
  context,
  gain,
  master,
  request,
  source,
}: ToneConnectionOptions): Effect.Effect<StereoPannerSurface, ToneGraphFailure> => {
  let panner: StereoPannerSurface | null = null
  return Effect.try({
    catch: (cause): ToneGraphFailure => ({ _tag: 'ToneGraphFailure', cause, soundId: request.soundId ?? null }),
    try: () => {
      source.connect(gain)
      panner = context.createStereoPanner()
      connectOutput({ gain, master, panner, request })
      return panner
    },
  }).pipe(
    Effect.catch((cause) => disconnectNodes([source, gain, panner]).pipe(Effect.flatMap(() => Effect.fail(cause)))),
  )
}

export const buildToneGraph = (options: ToneGraphOptions): Effect.Effect<ActiveTone, ToneGraphFailure> =>
  Effect.gen(function* buildToneGraphEffect() {
    const source = yield* createToneSource(options)
    let gain: GainSurface | null = null
    const scheduledGain = yield* Effect.try({
      catch: (cause) => graphFailure(options, cause),
      try: () => {
        gain = options.context.createGain()
        scheduleEnvelope(gain, options.envelope)
        return gain
      },
    }).pipe(
      Effect.catch((cause) => disconnectNodes([source, gain]).pipe(Effect.flatMap(() => Effect.fail(cause)))),
    )
    const panner = yield* connectToneNodes({ ...options, gain: scheduledGain, source })
    return { envelope: options.envelope, gain: scheduledGain, panner, releasing: false, source }
  })

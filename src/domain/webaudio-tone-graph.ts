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
import type { ToneRequest } from './backend-port.js'
import { clampPan } from './volume.js'

export const DEFAULT_TONE_WAVE: OscillatorWave = 'sine'

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
  readonly playbackRate: number
  readonly streamSource: AudioScheduledSourceSurface | null
}

type ToneSourceOptions = Pick<
  ToneGraphOptions,
  'context' | 'request' | 'sampleBuffer' | 'playbackRate' | 'streamSource'
>

const createSampleSource = ({
  context,
  request,
  sampleBuffer,
  playbackRate,
}: ToneSourceOptions): AudioScheduledSourceSurface | null => {
  const { createBufferSource } = context
  if (sampleBuffer === null || typeof createBufferSource !== 'function') {
    return null
  }

  try {
    const bufferSource = createBufferSource.call(context)
    bufferSource.buffer = sampleBuffer
    bufferSource.loop = request.loop
    bufferSource.playbackRate.value = playbackRate
    return bufferSource
  } catch {
    return null
  }
}

const createStreamSource = ({ streamSource }: ToneSourceOptions): AudioScheduledSourceSurface => {
  if (streamSource === null) {
    throw new Error('A streaming source is required for a streaming tone request')
  }
  return streamSource
}

const createOscillatorSource = ({ context, request }: ToneSourceOptions): OscillatorSurface => {
  const oscillator = context.createOscillator()
  oscillator.type = request.wave ?? DEFAULT_TONE_WAVE
  oscillator.frequency.value = drivenFrequency(request.frequency)
  return oscillator
}

const createStreamingSource = (options: ToneSourceOptions): AudioScheduledSourceSurface => {
  if (options.streamSource !== null) {
    return createStreamSource(options)
  }
  const sampleSource = createSampleSource(options)
  if (sampleSource !== null) {
    return sampleSource
  }
  return createStreamSource(options)
}

const createToneSource = (options: ToneSourceOptions): AudioScheduledSourceSurface => {
  if (options.request.stream === true) {
    return createStreamingSource(options)
  }

  const sampleSource = createSampleSource(options)
  if (sampleSource !== null) {
    return sampleSource
  }

  if (options.request.sampleOnly === true) {
    throw new Error(`No sample source is available for ${options.request.soundId ?? 'the requested audio'}`)
  }

  return createOscillatorSource(options)
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

const disconnectNodes = (nodes: ReadonlyArray<AudioScheduledSourceSurface | GainSurface | StereoPannerSurface | null>): void => {
  for (const node of nodes) {
    try {
      node?.disconnect()
    } catch {
      // Best-effort cleanup must not hide the graph construction failure.
    }
  }
}

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
}: ToneConnectionOptions): StereoPannerSurface => {
  let panner: StereoPannerSurface | null = null
  try {
    source.connect(gain)
    panner = context.createStereoPanner()
    connectOutput({ gain, master, panner, request })
    return panner
  } catch (cause) {
    disconnectNodes([source, gain, panner])
    throw cause
  }
}

export const buildToneGraph = (options: ToneGraphOptions): ActiveTone => {
  let source: AudioScheduledSourceSurface | null = null
  let gain: GainSurface | null = null

  try {
    source = createToneSource(options)
    gain = options.context.createGain()
    scheduleEnvelope(gain, options.envelope)
  } catch (cause) {
    disconnectNodes([source, gain])
    throw cause
  }

  const panner = connectToneNodes({ ...options, gain, source })
  return { envelope: options.envelope, gain, panner, releasing: false, source }
}

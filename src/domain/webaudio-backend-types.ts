import type { AudioAvailability, AudioBackend, ToneRequest } from './backend-port.js'
import type {
  AudioBufferSurface,
  AudioContextStateSurface,
  AudioContextSurface,
  AudioScheduledSourceSurface,
  WebAudioGlobalSurface,
} from './webaudio-surface.js'
import type { AudioSampleLoadReport, AudioSampleManifest, AudioSampleSource } from './audio-sample.js'
import type { Effect } from 'effect'
import type { WebAudioConstructorName } from './webaudio-runtime.js'

export type WebAudioOptions = {
  /**
   * Where to look for a constructor. In a browser this is `globalThis`; in a
   * test it is an object; in Node it is
   * `{ AudioContext: undefined, webkitAudioContext: undefined }` — the spelling
   * `WebAudioGlobalSurface` exists to make possible, because "I checked and
   * there is none" should look different from "I forgot".
   */
  readonly global: WebAudioGlobalSurface
  /**
   * The master node's gain before any `setMasterGain` call.
   *
   * Defaults to `DEFAULT_VOLUME_SETTINGS.master`. It matters because the
   * context may be created long after the player's settings were loaded: a
   * master node that starts at 1 and is corrected on the next settings change
   * plays the first cue at full volume.
   */
  readonly initialMasterGain?: number
  /** Maximum active tones. Additional cues are discarded and reported. */
  readonly maxConcurrentTones?: number
  /** Resolves an already-decoded sample; missing/failed samples use synthesis. */
  readonly resolveAudioBuffer?: (soundId: string) => AudioBufferSurface | null
  /** Manifest samples to decode. Manifest-backed cues also load lazily on first playback. */
  readonly sampleManifest?: AudioSampleManifest
  /** Host-owned URL transport, keeping fetch and DOM types outside the domain. */
  readonly loadSampleData?: (url: string) => Promise<ArrayBuffer>
  /** Host-owned source creation for sounds that must remain streamed. */
  readonly createStreamSource?: (options: WebAudioStreamSourceOptions) => AudioScheduledSourceSurface | null
  /** Host-owned preload for streamed sounds that cannot be decoded as buffers. */
  readonly preloadStream?: (soundId: string, source: AudioSampleSource) => Effect.Effect<boolean, unknown>
}

export type WebAudioStreamSourceOptions = {
  readonly context: AudioContextSurface
  readonly request: ToneRequest
  readonly soundId: string
  readonly source: AudioSampleSource
}

/** A diagnostic snapshot of the concrete WebAudio runtime. */
export type WebAudioReport = {
  readonly availability: AudioAvailability
  /** `null` until the context is created; see `makeWebAudioBackend` on laziness. */
  readonly contextState: AudioContextStateSurface | null
  /** `null` when the host had neither constructor. */
  readonly constructorName: WebAudioConstructorName | null
  /** `false` when `createStereoPanner` was absent, i.e. sound is MONO. */
  readonly stereo: boolean
  /** `true` once construction has been attempted, successfully or not. */
  readonly contextAttempted: boolean
  /** How many times `unlock` was run. */
  readonly unlockAttempts: number
  /** How many of those left the context not running. The autoplay refusals. */
  readonly unlockRefusals: number
  /** Cues the guard refused, and therefore discarded. Never queued. */
  readonly refusedTones: number
  /** Ready-state cues discarded because `maxConcurrentTones` was reached. */
  readonly capacityRefusals: number
  /** Tones currently scheduled or sounding. */
  readonly activeTones: number
  /** How many times the browser changed `state` without being asked. */
  readonly spontaneousStateChanges: number
  readonly muted: boolean
  readonly disposed: boolean
}

/** The AudioBackend with operations that require a concrete WebAudio runtime. */
export type WebAudioBackend = AudioBackend & {
  /** Decode configured samples. Concurrent requests for one id share one load. */
  readonly preloadSamples: (soundIds?: ReadonlyArray<string>) => Effect.Effect<AudioSampleLoadReport>
  /** Run from a user gesture handler and report the resulting availability. */
  readonly unlock: Effect.Effect<AudioAvailability>
  readonly report: Effect.Effect<WebAudioReport>
  /** Mute without forgetting the configured master gain. */
  readonly setMuted: (muted: boolean) => Effect.Effect<void>
  /** Permanently release nodes and the context. Safe to call repeatedly. */
  readonly dispose: Effect.Effect<void>
}

import { Brand } from 'effect'

const ZERO = 0
const ONE = 1
const NEGATIVE_ONE = -ONE

const validationResult = (isValid: boolean, error: string): true | string => {
  if (isValid) {
    return true
  }
  return error
}

export type AudioSampleId = string & Brand.Brand<'AudioSampleId'>
export const AudioSampleId: Brand.Constructor<AudioSampleId> = Brand.make<AudioSampleId>(
  (value) => validationResult(value.length > ZERO, 'Audio sample id must not be empty'),
)

export type AudioSampleUrl = string & Brand.Brand<'AudioSampleUrl'>
export const AudioSampleUrl: Brand.Constructor<AudioSampleUrl> = Brand.make<AudioSampleUrl>(
  (value) => validationResult(value.length > ZERO, 'Audio sample URL must not be empty'),
)

export type AudioFrequencyHz = number & Brand.Brand<'AudioFrequencyHz'>
export const AudioFrequencyHz: Brand.Constructor<AudioFrequencyHz> = Brand.make<AudioFrequencyHz>(
  (value) => validationResult(Number.isFinite(value) && value > ZERO, 'Audio frequency must be finite and positive'),
)

export type AudioDurationSecs = number & Brand.Brand<'AudioDurationSecs'>
export const AudioDurationSecs: Brand.Constructor<AudioDurationSecs> = Brand.make<AudioDurationSecs>(
  (value) => validationResult(Number.isFinite(value) && value >= ZERO, 'Audio duration must be finite and non-negative'),
)

export type AudioGain = number & Brand.Brand<'AudioGain'>
export const AudioGain: Brand.Constructor<AudioGain> = Brand.make<AudioGain>(
  (value) => validationResult(Number.isFinite(value) && value >= ZERO, 'Audio gain must be finite and non-negative'),
)

export type AudioVolume = number & Brand.Brand<'AudioVolume'>
export const AudioVolume: Brand.Constructor<AudioVolume> = Brand.make<AudioVolume>(
  (value) => validationResult(Number.isFinite(value) && value >= ZERO && value <= ONE, 'Audio volume must be between 0 and 1'),
)

export type AudioPan = number & Brand.Brand<'AudioPan'>
export const AudioPan: Brand.Constructor<AudioPan> = Brand.make<AudioPan>(
  (value) => validationResult(Number.isFinite(value) && value >= NEGATIVE_ONE && value <= ONE, 'Audio pan must be between -1 and 1'),
)

export type AudioPlaybackRate = number & Brand.Brand<'AudioPlaybackRate'>
export const AudioPlaybackRate: Brand.Constructor<AudioPlaybackRate> = Brand.make<AudioPlaybackRate>(
  (value) => validationResult(Number.isFinite(value) && value > ZERO, 'Audio playback rate must be finite and positive'),
)

export type AudioDistance = number & Brand.Brand<'AudioDistance'>
export const AudioDistance: Brand.Constructor<AudioDistance> = Brand.make<AudioDistance>(
  (value) => validationResult(Number.isFinite(value) && value >= ZERO, 'Audio distance must be finite and non-negative'),
)

export type AudioOffset = number & Brand.Brand<'AudioOffset'>
export const AudioOffset: Brand.Constructor<AudioOffset> = Brand.make<AudioOffset>(
  (value) => validationResult(Number.isFinite(value), 'Audio offset must be finite'),
)

export type AudioTick = number & Brand.Brand<'AudioTick'>
export const AudioTick: Brand.Constructor<AudioTick> = Brand.make<AudioTick>(
  (value) => validationResult(Number.isInteger(value) && value >= ZERO, 'Audio tick must be a non-negative integer'),
)

export type AudioDelayTicks = number & Brand.Brand<'AudioDelayTicks'>
export const AudioDelayTicks: Brand.Constructor<AudioDelayTicks> = Brand.make<AudioDelayTicks>(
  (value) => validationResult(Number.isInteger(value) && value >= ZERO, 'Audio delay must be a non-negative integer'),
)

export type AudioHandleId = number & Brand.Brand<'AudioHandleId'>
export const AudioHandleId: Brand.Constructor<AudioHandleId> = Brand.make<AudioHandleId>(
  (value) => validationResult(Number.isInteger(value) && value >= ZERO, 'Audio handle id must be a non-negative integer'),
)

export type AudioCount = number & Brand.Brand<'AudioCount'>
export const AudioCount: Brand.Constructor<AudioCount> = Brand.make<AudioCount>(
  (value) => validationResult(Number.isInteger(value) && value >= ZERO, 'Audio count must be a non-negative integer'),
)

export type AudioBpm = number & Brand.Brand<'AudioBpm'>
export const AudioBpm: Brand.Constructor<AudioBpm> = Brand.make<AudioBpm>(
  (value) => validationResult(Number.isFinite(value) && value > ZERO, 'Audio BPM must be finite and positive'),
)

export type AudioNote = number & Brand.Brand<'AudioNote'>
export const AudioNote: Brand.Constructor<AudioNote> = Brand.make<AudioNote>(
  (value) => validationResult(Number.isFinite(value), 'Audio note must be finite'),
)

export type AudioSampleRate = number & Brand.Brand<'AudioSampleRate'>
export const AudioSampleRate: Brand.Constructor<AudioSampleRate> = Brand.make<AudioSampleRate>(
  (value) => validationResult(Number.isInteger(value) && value > ZERO, 'Audio sample rate must be a positive integer'),
)

export type AudioSeed = number & Brand.Brand<'AudioSeed'>
export const AudioSeed: Brand.Constructor<AudioSeed> = Brand.make<AudioSeed>(
  (value) => validationResult(Number.isSafeInteger(value), 'Audio seed must be a safe integer'),
)

export type AudioEventId = string & Brand.Brand<'AudioEventId'>
export const AudioEventId: Brand.Constructor<AudioEventId> = Brand.make<AudioEventId>(
  (value) => validationResult(value.length > ZERO, 'Audio event id must not be empty'),
)

export type AudioWeight = number & Brand.Brand<'AudioWeight'>
export const AudioWeight: Brand.Constructor<AudioWeight> = Brand.make<AudioWeight>(
  (value) => validationResult(Number.isInteger(value) && value > ZERO, 'Audio weight must be a positive integer'),
)

export type MinecraftSoundEventId = string & Brand.Brand<'MinecraftSoundEventId'>
export const MinecraftSoundEventId: Brand.Constructor<MinecraftSoundEventId> = Brand.make<MinecraftSoundEventId>(
  (value) => validationResult(value.length > ZERO, 'Minecraft sound event id must not be empty'),
)

export type MinecraftSoundResourceId = string & Brand.Brand<'MinecraftSoundResourceId'>
export const MinecraftSoundResourceId: Brand.Constructor<MinecraftSoundResourceId> = Brand.make<MinecraftSoundResourceId>(
  (value) => validationResult(value.length > ZERO, 'Minecraft sound resource id must not be empty'),
)

export type MinecraftMobSoundVariantId = string & Brand.Brand<'MinecraftMobSoundVariantId'>
export const MinecraftMobSoundVariantId: Brand.Constructor<MinecraftMobSoundVariantId> = Brand.make<MinecraftMobSoundVariantId>(
  (value) => validationResult(value.length > ZERO, 'Minecraft mob sound variant id must not be empty'),
)

export type MinecraftSoundNamespace = string & Brand.Brand<'MinecraftSoundNamespace'>
export const MinecraftSoundNamespace: Brand.Constructor<MinecraftSoundNamespace> = Brand.make<MinecraftSoundNamespace>(
  (value) => validationResult(/^[a-z0-9_.-]+$/u.test(value), 'Minecraft sound namespace must be lowercase resource text'),
)

export type AudioDiagnosticPath = string & Brand.Brand<'AudioDiagnosticPath'>
export const AudioDiagnosticPath: Brand.Constructor<AudioDiagnosticPath> = Brand.nominal<AudioDiagnosticPath>()

export type AudioDiagnosticMessage = string & Brand.Brand<'AudioDiagnosticMessage'>
export const AudioDiagnosticMessage: Brand.Constructor<AudioDiagnosticMessage> = Brand.nominal<AudioDiagnosticMessage>()

export type AudioCaptionText = string & Brand.Brand<'AudioCaptionText'>
export const AudioCaptionText: Brand.Constructor<AudioCaptionText> = Brand.nominal<AudioCaptionText>()

export type AudioRuntimeCaptionSignature = string & Brand.Brand<'AudioRuntimeCaptionSignature'>
export const AudioRuntimeCaptionSignature: Brand.Constructor<AudioRuntimeCaptionSignature> =
  Brand.nominal<AudioRuntimeCaptionSignature>()


import type { AudioContextStateSurface, AudioContextSurface, GainSurface, WebAudioGlobalSurface } from './webaudio-surface.js'
import type { AudioAvailability } from './backend-port.js'
import { Option } from 'effect'

export type WebAudioConstructorName = 'AudioContext' | 'webkitAudioContext'

export type ContextRuntime = {
  readonly context: AudioContextSurface
  readonly master: GainSurface
  readonly constructorName: WebAudioConstructorName
  readonly stereo: boolean
}

export const availabilityForState = (state: AudioContextStateSurface): AudioAvailability => {
  if (state === 'running') {
    return 'ready'
  }
  if (state === 'closed') {
    return 'unavailable'
  }
  return 'locked'
}

export const findWebAudioConstructor = (global: WebAudioGlobalSurface): Option.Option<{
  readonly construct: new () => AudioContextSurface
  readonly name: WebAudioConstructorName
}> => {
  const audioContextConstructor = global.AudioContext
  if (typeof audioContextConstructor === 'function') {
    return Option.some({ construct: audioContextConstructor, name: 'AudioContext' })
  }
  const webkitAudioContextConstructor = global.webkitAudioContext
  if (typeof webkitAudioContextConstructor === 'function') {
    return Option.some({ construct: webkitAudioContextConstructor, name: 'webkitAudioContext' })
  }
  return Option.none()
}

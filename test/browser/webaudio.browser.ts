import { Effect } from 'effect'
import { expect, test } from 'vitest'
import { makeWebAudioBackend } from '../../src/domain/webaudio-adapter.js'
import type { WebAudioGlobalSurface } from '../../src/domain/webaudio-surface.js'

type Connection = {
  readonly from: string
  readonly to: string
}

test('plays a real WebAudio cue through the mixer and stops it', async () => {
  const connections: Connection[] = []
  const originalConnect = AudioNode.prototype.connect

  Object.defineProperty(AudioNode.prototype, 'connect', {
    configurable: true,
    value(this: AudioNode, destination: AudioNode): AudioNode {
      connections.push({
        from: this.constructor.name,
        to: destination.constructor.name,
      })
      const connected = Reflect.apply(originalConnect, this, [destination])
      if (!(connected instanceof AudioNode)) {
        throw new Error('AudioNode.connect did not return an AudioNode')
      }
      return connected
    },
    writable: true,
  })

  const global: WebAudioGlobalSurface = { AudioContext }
  const backend = await Effect.runPromise(makeWebAudioBackend({ global }))

  try {
    await expect(Effect.runPromise(backend.unlock)).resolves.toBe('ready')
    await expect(Effect.runPromise(backend.availability)).resolves.toBe('ready')

    const playback = await Effect.runPromise(backend.playTone({
      durationSecs: 0.1,
      frequency: 440,
      gain: 0.25,
      loop: true,
      pan: 0,
    }))

    expect(playback.accepted).toBe(true)
    expect(connections).toEqual(expect.arrayContaining([
      { from: 'GainNode', to: 'AudioDestinationNode' },
      { from: 'OscillatorNode', to: 'GainNode' },
      { from: 'GainNode', to: 'StereoPannerNode' },
      { from: 'StereoPannerNode', to: 'GainNode' },
    ]))
    await expect(Effect.runPromise(backend.isToneActive(playback))).resolves.toBe(true)

    await Effect.runPromise(backend.stopTone(playback))
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 100)
    })
    await expect(Effect.runPromise(backend.isToneActive(playback))).resolves.toBe(false)
  } finally {
    await Effect.runPromise(backend.dispose)
    Object.defineProperty(AudioNode.prototype, 'connect', {
      configurable: true,
      value: originalConnect,
      writable: true,
    })
  }
})

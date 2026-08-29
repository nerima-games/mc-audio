/* oxlint-disable max-statements, new-cap, no-empty-function, no-magic-numbers, no-ternary, no-undefined -- This compile fixture deliberately exercises browser constructor/optional-member signatures with inert callbacks and literal audio parameters. */
/**
 * NOT A TEST — a fixture that is COMPILED by one.
 *
 * `test/webaudio-surface.test.ts` builds a TypeScript program over this file
 * with `lib: ["ES2024", "DOM"]` and asserts it produces zero diagnostics. That
 * is what proves the claim `domain/webaudio-surface.ts` makes: a real
 * `AudioContext`, `OscillatorNode`, `GainNode`, `StereoPannerNode`, `AudioNode`
 * and `AudioParam` satisfy the adapter's structural types WITHOUT A CAST.
 *
 * The claim is not obvious and it is not stable under a careless edit. Two of
 * the members below were written wrong on the first attempt and the compiler
 * caught both, which is the entire argument for this file existing:
 *
 *   1. `state` was `'suspended' | 'running' | 'closed'`, the three states the
 *      specification documents. `AudioContextState` has a fourth,
 *      `'interrupted'`, and an adapter that had never heard of it would report
 *      an interrupted iOS session as READY. See the doc comment on
 *      `AudioContextStateSurface`.
 *   2. `connect` was a property, which is how every other member here is
 *      spelled and which under `strictFunctionTypes` is the strict direction.
 *      A real `AudioNode` is not assignable to it, and cannot be made so
 *      without describing all of `AudioNode`. It is a method for that reason
 *      and the module header says what the bivariance costs.
 *
 * Nothing in the ordinary `pnpm typecheck` would notice either mistake, because
 * that project has no DOM to be assignable FROM. The first person to notice
 * would be a browser consumer, and the fix they would reach for is
 * `as unknown as AudioContext`, which is where the type safety would actually
 * be lost.
 *
 * Excluded from `tsconfig.json`, `tsconfig.test.json` and
 * `tsconfig.preview.json` (`test/fixtures/**`), because it names DOM types
 * those projects deliberately cannot see. It is still linted and still scanned
 * by `pnpm check:deps`.
 */
import type {
  AudioBufferSourceSurface,
  AudioBufferSurface,
  AudioContextConstructorSurface,
  AudioContextStateSurface,
  AudioContextSurface,
  AudioNodeSurface,
  AudioParamSurface,
  GainSurface,
  OscillatorSurface,
  OscillatorWave,
  StereoPannerSurface,
} from '../../src/domain/webaudio-surface'

declare const browserContext: AudioContext
declare const browserBuffer: AudioBuffer
declare const browserBufferSource: AudioBufferSourceNode
declare const browserNode: AudioNode
declare const browserParam: AudioParam
declare const browserOscillator: OscillatorNode
declare const browserGain: GainNode
declare const browserPanner: StereoPannerNode
declare const browserDestination: AudioDestinationNode
declare const browserState: AudioContextState
declare const browserWave: OscillatorType

export const contextIsAnAudioContextSurface: AudioContextSurface = browserContext
export const bufferIsAnAudioBufferSurface: AudioBufferSurface = browserBuffer
export const bufferSourceIsAnAudioBufferSourceSurface: AudioBufferSourceSurface = browserBufferSource
export const nodeIsAnAudioNodeSurface: AudioNodeSurface = browserNode
export const paramIsAnAudioParamSurface: AudioParamSurface = browserParam
export const oscillatorIsAnOscillatorSurface: OscillatorSurface = browserOscillator
export const gainIsAGainSurface: GainSurface = browserGain
export const pannerIsAStereoPannerSurface: StereoPannerSurface = browserPanner

/**
 * `AudioDestinationNode` is what `context.destination` actually is, and the
 * surface types that slot as a plain `AudioNodeSurface`. This line is what says
 * the subclass still fits.
 */
export const destinationIsAnAudioNodeSurface: AudioNodeSurface = browserDestination

/**
 * THE TWO UNIONS, both directions.
 *
 * Assigning the real union to ours proves ours is not too NARROW — this is the
 * line that rejected the three-state `AudioContextState` and is the reason
 * `'interrupted'` is handled at all.
 */
export const stateIsAnAudioContextStateSurface: AudioContextStateSurface = browserState
export const waveIsAnOscillatorWave: OscillatorWave = browserWave

/**
 * ...and ours to the real one, which proves ours is not too WIDE.
 *
 * Without this, a surface that spelled a state `'interupted'` or a wave
 * `'sawtooh'` would compile happily and produce a value no browser will ever
 * hand back or accept. The narrowing direction alone cannot catch a typo.
 */
export const surfaceStatesAreRealStates = (state: AudioContextStateSurface): AudioContextState =>
  state
export const surfaceWavesAreRealWaves = (wave: OscillatorWave): OscillatorType => wave

/** `globalThis.AudioContext`, as the adapter's feature detection reads it. */
export const constructorIsAnAudioContextConstructorSurface: AudioContextConstructorSurface =
  AudioContext

/**
 * THE DIRECTION THAT ACTUALLY BITES, part one: handlers.
 *
 * Everything above checks that the real thing is assignable to our type. This
 * checks the other direction that matters in practice: a handler WE write has
 * to be acceptable to the REAL slot, whose declared type is
 * `((this: BaseAudioContext, ev: Event) => any) | null`.
 *
 * A zero-argument arrow is assignable to that (fewer parameters is always fine
 * in the source position), which is exactly why the surface can demand `never`
 * on the way in and still be driven with `() => {}` on the way out.
 */
export const installsHandlersOnTheRealThing = (): void => {
  browserContext.onstatechange = () => {}
  browserOscillator.onended = () => {}
}

/**
 * THE DIRECTION THAT ACTUALLY BITES, part two: the whole adapter flow, spelled
 * against the NARROW types but executed on real objects.
 *
 * This is the shape `makeWebAudioBackend` drives, in the order it drives it. If
 * a future edit widens a parameter — `start` gaining a required `when`, or
 * `connect` gaining an output index this repository relies on — this function
 * is where the compiler will say so against the real declarations rather than
 * in a browser.
 */
export const drivesTheRealApiThroughTheNarrowTypes = async (): Promise<void> => {
  const context: AudioContextSurface = new AudioContext()

  const master = context.createGain()
  master.gain.value = 0.8
  master.connect(context.destination)

  // The guard. `resume()` is the only call a browser restricts, and the state
  // Is re-read afterwards rather than the promise being trusted.
  await context.resume()
  const state: AudioContextStateSurface = context.state

  if (state === 'running') {
    const oscillator = context.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.value = 220

    const gain = context.createGain()
    gain.gain.setValueAtTime(0, context.currentTime)
    gain.gain.linearRampToValueAtTime(0.4, context.currentTime + 0.005)
    gain.gain.cancelScheduledValues(context.currentTime + 0.05)

    oscillator.connect(gain)

    const panner = context.createStereoPanner()
    panner.pan.value = -0.25
    gain.connect(panner)
    panner.connect(master)
    panner.disconnect()

    oscillator.onended = () => {
      // The event is UNREADABLE here, on purpose — see the header of
      // `domain/webaudio-surface.ts`. Only the fact matters.
      oscillator.disconnect()
      gain.disconnect()
    }

    oscillator.start(context.currentTime)
    oscillator.stop(context.currentTime + 0.07)
  }

  context.onstatechange = () => {}
  await context.close()
}

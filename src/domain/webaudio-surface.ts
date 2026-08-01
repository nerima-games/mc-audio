/**
 * THE ENTIRE WEB AUDIO SURFACE THIS REPOSITORY DEPENDS ON, IN ONE FILE.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists instead of `"lib": ["ES2024", "DOM"]`
 * ---------------------------------------------------------------------------
 *
 * `tsconfig.base.json` ships `lib: ["ES2024"]` and `types: []`, and its comment
 * names this adapter as the one thing that would add `"DOM"`. Adding it would
 * work, and it would cost the property this repository is arranged around:
 * `pnpm typecheck` over `tsconfig.build.json` is currently a PROOF that the
 * audio core is platform-free. With `"DOM"` on, `domain/engine.ts` could reach
 * for `window`, `domain/caption.ts` could reach for `document` and
 * `domain/volume.ts` could reach for `localStorage`, and nothing would notice
 * for months — mc-audio would still typecheck, still test green, and would have
 * quietly stopped being usable from a worker, a server, or the 61-test Node
 * suite that `docs/testing.md` §2 is proud of. `docs/architecture.md` §3 says
 * the DOM-free `lib` is "what forces the WebAudio-specific parts behind
 * `AudioBackendPort`"; a DOM-wide `lib` removes the force and leaves the
 * intention.
 *
 * mc-save reached this conclusion first and its
 * `domain/indexeddb-surface.ts` records the mechanical reason a SECOND TSCONFIG
 * is not the answer either, and it applies here verbatim:
 * `scripts/api-lock.ts` builds its report from `REPOSITORY_POLICY.tsconfigFile`
 * = `tsconfig.build.json`, and `scripts/check-dependency-whitelist.ts`
 * classifies shipped source as `index.ts` plus `domain/`. An adapter outside
 * `tsconfig.build.json` could not be re-exported from `index.ts` without the
 * API lock either missing it or failing to emit — so the one file in this
 * repository that talks to a real audio device would be the one file no gate
 * could see.
 *
 * So: DESCRIBE, structurally, the handful of Web Audio members the adapter
 * actually uses. mc-save did this for `IDBFactory`, mc-render for `window` and
 * `document` (`application/dom-surface.ts`) and mx-ui for `Document` and
 * `HTMLElement`; this is the same move for `AudioContext`.
 *
 * ---------------------------------------------------------------------------
 * The property that makes it safe, and how it is proved
 * ---------------------------------------------------------------------------
 *
 * A hand-written structural type is only useful if a REAL `AudioContext`
 * satisfies it WITHOUT A CAST. `test/fixtures/webaudio-surface.ts` is compiled
 * BY A TEST against the real `lib.dom.d.ts` and asserted to produce zero
 * diagnostics, so that claim is checked by CI rather than asserted in this
 * comment. It is the other half of a proof whose first half is `pnpm
 * typecheck`: the build project still compiles with no `lib.DOM` at all, so no
 * file here can have grown a `window` reference.
 *
 * That proof has already paid for itself once, and the receipt is
 * `AudioContextState` below.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE STRUCTURAL APPROACH IS DEFEATED: `AudioNode.connect`
 * ---------------------------------------------------------------------------
 *
 * This is the one member that cannot be spelled the way every other member here
 * is spelled, and pretending otherwise would be the dishonest part of the file.
 *
 * Everything else is a `readonly` PROPERTY holding a function, which under
 * `strictFunctionTypes` is checked CONTRAVARIANTLY in its parameters — the
 * strict direction, and the one mc-save's header explains at length. `connect`
 * cannot be. Spelled as a property:
 *
 *   readonly connect: (destination: AudioNodeSurface) => AudioNodeSurface
 *
 * a real `AudioNode` is rejected, and the compiler says exactly why (measured
 * against TypeScript 5.9's `lib.dom.d.ts`):
 *
 *   Type 'AudioNode' is not assignable to type 'AudioNodeSurface'.
 *     Types of property 'connect' are incompatible.
 *       Types of parameters 'destinationNode' and 'destination' are incompatible.
 *         Type 'AudioNodeSurface' is missing the following properties from type
 *         'AudioNode': channelCount, channelCountMode, channelInterpretation,
 *         context, and 5 more.
 *
 * Read what that demands. Contravariance requires OUR parameter type to be a
 * SUBTYPE of `AudioNode` — so to spell `connect` strictly, the surface would
 * have to describe `channelCount`, `channelCountMode`, `channelInterpretation`,
 * `context`, `numberOfInputs`, `numberOfOutputs` and the whole `EventTarget`
 * base. That is not a narrow surface; that is `lib.dom` with extra steps. The
 * only subtype of `AudioNode` writable without `lib.dom` is `never`, and a
 * `connect` that takes `never` cannot be called.
 *
 * So `connect` is declared with METHOD syntax, which TypeScript checks
 * BIVARIANTLY by design, and the fixture proves a real `AudioNode` satisfies
 * it. The honest question is what that bivariance costs, and the answer is
 * genuinely "nothing that `lib.dom` would have caught either":
 *
 *   - The hole bivariance opens is passing a NON-`AudioNode` that happens to
 *     match this shape to a real node's `connect`. The adapter never does: the
 *     only values it connects are the ones it just created from the same
 *     context, four lines above.
 *   - The failure this would guard against — connecting nodes that belong to
 *     DIFFERENT `AudioContext`s — is `InvalidAccessError` at runtime, and
 *     `lib.dom` accepts it too. `AudioNode.context` exists but nothing in the
 *     type system relates two nodes' contexts. A full-fidelity DOM lib is
 *     exactly as unable to catch it as this file is.
 *
 * `disconnect` is a property, because it takes no arguments and therefore has
 * no contravariant position to lose. The mixed style is deliberate: it marks,
 * visually, the one member that is checked loosely.
 */

/**
 * `AudioParam`, reduced to the four members the adapter touches.
 *
 * `value` is NOT `readonly`: it is assigned to, which is how a gain is set
 * outside of a scheduled ramp. Every other member here is `readonly`, so the
 * mutability is visibly confined to the one slot that needs it.
 *
 * The three scheduling methods are the reason `domain/envelope.ts` exists.
 * The reference implementation set `gainNode.gain.value` flat and then called
 * `oscillator.stop(...)` (`packages/game/infrastructure/audio-engine.ts:103-105`),
 * which cuts the waveform mid-cycle and produces an audible click on every
 * single cue. Ramping is the fix, and it needs these three.
 *
 * They return `AudioParamSurface` because the real ones return `AudioParam` —
 * that is a RETURN position, checked covariantly, so a real `AudioParam` being
 * assignable to this type is all that is required and the fixture proves it.
 * The adapter never uses the return value; it is modelled so that a future
 * chained call does not have to reopen this file.
 */
export type AudioParamSurface = {
  value: number
  readonly setValueAtTime: (value: number, startTime: number) => AudioParamSurface
  readonly linearRampToValueAtTime: (value: number, endTime: number) => AudioParamSurface
  readonly cancelScheduledValues: (cancelTime: number) => AudioParamSurface
}

/**
 * Anything the adapter can wire into the graph.
 *
 * `connect` is a METHOD and `disconnect` is a PROPERTY, and that asymmetry is
 * the file's one loose spot rather than an oversight. See the module header.
 */
export type AudioNodeSurface = {
  connect(destination: AudioNodeSurface): AudioNodeSurface
  readonly disconnect: () => void
}

/**
 * The four waveforms plus the one this repository never uses.
 *
 * `'custom'` is here because `OscillatorType` in `lib.dom.d.ts` has it, and a
 * property is checked covariantly: leaving it out makes a real `OscillatorNode`
 * unassignable. It is nonetheless unreachable through mc-audio, because
 * selecting it requires `setPeriodicWave` and a `PeriodicWave`, neither of
 * which is modelled here — assigning `'custom'` without one leaves the
 * oscillator on its previous waveform in a real browser.
 *
 * If sample playback lands (`docs/responsibility.md` § assets: the reference
 * has no audio files at all and synthesises everything), it arrives as
 * `AudioBufferSourceNode`, which is a different node and a different addition
 * to this file — not as `'custom'`.
 */
export type OscillatorWave = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'custom'

/**
 * One oscillator.
 *
 * `onended` takes `never` for the reason mc-save's `indexeddb-surface.ts`
 * documents at length: `lib.dom` declares these slots as PROPERTIES holding
 * functions, so under `strictFunctionTypes` the parameter is contravariant, and
 * the only subtype of `Event` writable without `lib.dom` is `never`. THE EVENT
 * CANNOT BE READ through this surface, which costs nothing — the adapter needs
 * to know THAT the tone ended, so it can release its nodes, and the `Event`
 * carries no information beyond that.
 *
 * `start` and `stop` take an OPTIONAL `when`. The adapter always passes one,
 * because scheduling against `context.currentTime` is how audio timing works
 * here and is why this repository can honour the `Date.now()` ban without an
 * escape hatch (`docs/public-api.md` §7). The parameter stays optional because
 * the real signature has it optional and narrowing it to required would make a
 * real `OscillatorNode` unassignable in the `stop()` case.
 */
export type AudioScheduledSourceSurface = AudioNodeSurface & {
  readonly start: (when?: number) => void
  readonly stop: (when?: number) => void
  onended: ((event: never) => void) | null
}

export type AudioBufferSurface = { readonly duration: number }

export type AudioBufferSourceSurface = AudioScheduledSourceSurface & {
  buffer: AudioBufferSurface | null
  loop: boolean
}

export type OscillatorSurface = AudioScheduledSourceSurface & {
  type: OscillatorWave
  readonly frequency: AudioParamSurface
}

export type GainSurface = AudioNodeSurface & {
  readonly gain: AudioParamSurface
}

/**
 * `StereoPannerNode`, which is what `ToneRequest.pan` actually means.
 *
 * The reference used a `PannerNode` in `'equalpower'` mode and set
 * `positionX.value = clampPan(pan) * 10` (`audio-engine.ts:74-77`) — a 3D
 * spatialiser driven with a fabricated coordinate to fake a 1D control. The
 * `* 10` is unexplained there and the result does not equal the stereo pan it
 * was standing in for. `StereoPannerNode.pan` is [-1, 1] and is the same number
 * `domain/volume.ts` already computes, so the conversion disappears.
 */
export type StereoPannerSurface = AudioNodeSurface & {
  readonly pan: AudioParamSurface
}

/**
 * `AudioContextState` — AND THE RECEIPT FOR THIS WHOLE APPROACH.
 *
 * This type was first written as `'suspended' | 'running' | 'closed'`, which is
 * what the Web Audio specification and every tutorial say. The fixture refused
 * it, with:
 *
 *   Type 'AudioContextState' is not assignable to type
 *   '"suspended" | "running" | "closed"'.
 *     Type '"interrupted"' is not assignable to ...
 *
 * `'interrupted'` is a real fourth state. It is what iOS Safari moves a context
 * to when a phone call, Siri, or another app takes the audio session — the
 * context is neither running nor suspended, and `resume()` may or may not
 * recover it without a fresh user gesture. `domain/webaudio-adapter.ts` maps it
 * to `locked` for exactly that reason: `locked` is mc-audio's word for "a
 * backend exists but sound is not currently reaching the player, and a gesture
 * may fix it" (`domain/backend-port.ts`), which is precisely what an
 * interrupted session is.
 *
 * Nobody involved knew this state existed. It was not found by reading the
 * specification, by testing, or by review — it was found by a compiler being
 * shown the real declarations, which is the entire argument for compiling the
 * fixture instead of trusting this file. Had the surface simply been widened to
 * `"DOM"`, the adapter would have written `state === 'suspended' ? locked :
 * ready` and reported an interrupted iOS session as READY: captions labelled
 * `audible` for sound nobody can hear, which is the exact failure
 * `docs/design-notes.md` DN-1 exists to prevent, on the exact platform where
 * audio is most fragile.
 */
export type AudioContextStateSurface = 'suspended' | 'running' | 'closed' | 'interrupted'

/**
 * The context itself.
 *
 * `currentTime` is the clock this repository schedules against. It is monotonic
 * seconds from the audio device, not a wall clock, so reading it does not
 * violate the `Date.now()` / `performance.now()` ban that
 * `scripts/check-dependency-whitelist.ts` enforces, and the
 * `mc-kernel-allow-time-source` escape hatch is NOT taken anywhere in this
 * repository. `docs/public-api.md` §7 anticipated this and it turned out to be
 * true.
 *
 * `createPanner` is deliberately absent: see `StereoPannerSurface`.
 *
 * `suspend()` is deliberately absent. Nothing here should ever suspend a
 * context — a player muting audio is `enabled: false` in `CueContext`, which is
 * a different thing (`domain/engine.ts`), and suspending would make the
 * adapter's own report say `locked` for a state the player chose.
 */
export type AudioContextSurface = {
  readonly state: AudioContextStateSurface
  readonly currentTime: number
  readonly destination: AudioNodeSurface
  /**
   * Ask the browser to start or resume playback.
   *
   * REJECTS when the autoplay policy is unsatisfied, which is the single most
   * important fact in this file. The reference implementation swallowed that
   * rejection (`audio-engine.ts:46-49`,
   * `Effect.catchAllCause(() => Effect.void)`) and carried on building
   * oscillators that never sounded. `domain/webaudio-adapter.ts` turns the
   * rejection into an `AudioAvailability` value instead.
   */
  readonly resume: () => Promise<void>
  readonly close: () => Promise<void>
  readonly createOscillator: () => OscillatorSurface
  readonly createBufferSource?: () => AudioBufferSourceSurface
  readonly createGain: () => GainSurface
  /**
   * OPTIONAL, and honestly so: `createStereoPanner` is absent in Safari before
   * 14.1, and the adapter therefore feature-detects it and falls back to
   * connecting gain straight to master. The fallback is MONO, and the adapter
   * says so in its report rather than silently centring the sound — a player
   * wondering why footsteps have no direction deserves an answer.
   *
   * A real `BaseAudioContext` declares it as REQUIRED, and an optional member
   * is satisfied by a required one; the fixture proves that direction.
   */
  readonly createStereoPanner?: () => StereoPannerSurface
  /**
   * Fires when the browser changes `state` behind our back — most importantly
   * when iOS ends an interruption, and when a policy change unlocks a context
   * without the page asking.
   *
   * Modelled rather than ignored because the alternative is a cached
   * availability that is wrong until the next cue: a player who answered a
   * phone call would come back to a game that believes it is still muted.
   * Takes `never` for the same contravariance reason as `onended`.
   */
  onstatechange: ((event: never) => void) | null
}

/**
 * `new AudioContext()`, as a value.
 *
 * The construct signature takes NO arguments even though the real one accepts
 * an optional `AudioContextOptions`. Fewer parameters is fine in this direction
 * (the fixture proves it), and the options bag holds `latencyHint` and
 * `sampleRate` — two settings that would change what the player hears and that
 * nothing in mc-audio has an opinion about. Adding them is a decision with a
 * reason, not a default.
 */
export type AudioContextConstructorSurface = new () => AudioContextSurface

/**
 * The global object, as far as feature detection needs it.
 *
 * BOTH MEMBERS ARE OPTIONAL, and that is the whole point: this type is a
 * QUESTION, not a claim. In Node and in SSR neither exists; in a modern browser
 * `AudioContext` does; in Safari before 14.1 only `webkitAudioContext` does.
 * Passing `globalThis` to `webAudioBackendLayer` therefore answers "is there
 * any Web Audio here at all", and the adapter — not the host application —
 * owns the answer. That is a deliberate difference from the reference, which
 * did `typeof AudioContext === 'undefined'` inside the engine and consequently
 * could not be tested at all, because there is no way to make that expression
 * false in a Node test (`docs/porting.md` §6: `audio-context-helpers.ts` has
 * zero tests, and this is why).
 *
 * `webkitAudioContext` does not exist in `lib.dom.d.ts`, so a real `globalThis`
 * simply lacks it — which is legal for an optional member, and is proved by the
 * fixture. The prefixed constructor is one of the four items
 * `docs/public-api.md` §7 lists as NEW work rather than porting, because a grep
 * for `webkitAudioContext` across the reference returns nothing.
 *
 * Both members are ALSO `| undefined`, on top of being optional, so that
 * `{ AudioContext: undefined, webkitAudioContext: undefined }` is a legal way to
 * say "I looked and there is none". Under `exactOptionalPropertyTypes` — which
 * `tsconfig.base.json` sets — an optional-only member CANNOT be assigned
 * `undefined` explicitly, and the absent case would have to be spelled `{}`.
 * `{}` is a shrug; the explicit spelling is a statement, and the difference
 * shows up in a diff.
 *
 * A type whose members are ALL optional is a "weak type", which TypeScript
 * refuses to accept an unrelated source for. Measured: an unrelated options bag
 * is rejected with 「has no properties in common with type
 * 'WebAudioGlobalSurface'」, which is the mistake worth catching — passing the
 * wrong object. Note that `{}` is NOT rejected: the weak-type check only fires
 * when the source HAS properties, so an empty literal still compiles. That is a
 * real limit of the guard rather than a claim being made for it.
 */
export type WebAudioGlobalSurface = {
  readonly AudioContext?: AudioContextConstructorSurface | undefined
  readonly webkitAudioContext?: AudioContextConstructorSurface | undefined
}

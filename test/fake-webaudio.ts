/**
 * A Web Audio implementation, in one file, that makes no sound.
 *
 * NOT A TEST — a helper the adapter tests and `apps/preview-soundboard` build
 * on. It exists because `vitest.config.ts` runs `environment: 'node'`, and that
 * is a decision rather than a default (`docs/testing.md` §2): the alternative
 * was jsdom, which has no Web Audio at all, or `web-audio-test-api` from npm,
 * which is written against `lib.dom.d.ts` and would therefore drag `"DOM"` back
 * in through `types` and delete the property `domain/webaudio-surface.ts`
 * exists to protect.
 *
 * The reason this fake is TRUSTWORTHY is `test/fixtures/webaudio-surface.ts`:
 * every class below satisfies the surface types with NO CAST, and a real
 * `AudioContext` satisfies those same types with no cast, proved by compiling
 * that fixture against the real `lib.dom.d.ts`. A fake that needed
 * `as unknown as AudioContext` would prove nothing about a browser — it would
 * prove things about the cast.
 *
 * mc-save's `test/fake-indexeddb.ts` and `test/binary-roundtrip.test.ts` draw
 * this same line for what they do and do not stand in for, and this file is
 * held to it. The line matters more here than it did there, because audio has a
 * uniquely tempting thing to fake badly.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES REPRODUCE
 * ---------------------------------------------------------------------------
 *
 *  - THE ABSENCE OF WEB AUDIO. `present: false` gives a global with neither
 *    constructor, which is Node and SSR. This is the branch the reference
 *    implementation could not test at all, because its detection read a global
 *    (`typeof AudioContext === 'undefined'`) that no Node test can falsify —
 *    `docs/porting.md` §6 records the resulting zero tests.
 *  - BOTH SPELLINGS. `prefixed: true` exposes only `webkitAudioContext`, which
 *    is Safari before 14.1.
 *  - CONSTRUCTION FAILING. Chrome caps hardware contexts at six per page and
 *    throws on the seventh.
 *  - THE FOUR-STATE MACHINE, including `'interrupted'` — the state
 *    `domain/webaudio-surface.ts` records as having been found by the compiler
 *    rather than by anybody's knowledge.
 *  - REFUSAL, IN ITS THREE REAL SHAPES. `resume()` may reject; it may resolve
 *    and leave the context suspended (Safari does this); or it may work. All
 *    three are selectable, because the adapter must behave the same for the
 *    first two and the middle one is the one that fools code that trusts the
 *    promise.
 *  - SPONTANEOUS TRANSITIONS. `interrupt()` and `endInterruption()` fire
 *    `onstatechange` without being asked, which is the iOS phone-call sequence.
 *  - GRAPH TOPOLOGY. Every node created and every edge connected, in order, so
 *    "the oscillator went through a gain and a panner to master" is an
 *    assertion rather than a reading of the adapter's source.
 *  - AUTOMATION CALLS. Every `setValueAtTime`, `linearRampToValueAtTime`,
 *    `cancelScheduledValues` and direct `.value` assignment, with its time and
 *    value, in order.
 *  - DISCONNECTION AND `onended`, so a leaked node is observable.
 *  - A VIRTUAL AUDIO CLOCK. `currentTime` advances only when `advance()` is
 *    called, which is what lets a 70 ms cue be stepped through without waiting
 *    70 ms and without a wall clock anywhere.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT REPRODUCE, and what therefore stays a browser question
 * ---------------------------------------------------------------------------
 *
 *  - SOUND. Nothing here is audible and nothing here is evidence that anything
 *    is. Every green test in `test/webaudio-adapter.test.ts` says the adapter
 *    built and scheduled what it meant to; not one of them says a player heard
 *    it.
 *
 *  - AUDIO TIMING, AND THIS IS THE IMPORTANT ONE. `currentTime` moves in
 *    whatever steps a caller asks for. There is no sample rate, no 128-frame
 *    render quantum, no output latency, and no drift between the audio clock
 *    and anything else. A real browser quantises every scheduled event to a
 *    render quantum and applies output latency on top, so a ramp asked to end
 *    at t does not end at t.
 *
 *    Making this fake model that would be WORSE THAN NOT HAVING IT. The numbers
 *    would be plausible, they would be wrong — sample rate, quantum and latency
 *    all vary by device and by browser — and a suite that went green against
 *    them would have converted "we do not know how this sounds" into "we have
 *    tested how this sounds". The envelope's shape is asserted in
 *    `test/envelope.test.ts` as ARITHMETIC, on `gainAt`, where it is exactly
 *    true; whether that arithmetic removes the click in a browser is a
 *    listening test and is written down as one in
 *    `docs/testing.md` §4.
 *
 *  - PARAMETER INTERPOLATION. The fake RECORDS automation calls; it does not
 *    evaluate them. `gain.value` after a scheduled ramp is whatever was last
 *    assigned directly, not what the curve would give. `gainAt` is the model of
 *    the curve and it is tested separately.
 *
 *  - THE AUTOPLAY POLICY ITSELF. The fake is TOLD whether to refuse. It cannot
 *    tell you whether a given browser would accept a given gesture, whether a
 *    `pointerdown` counts where a `pointermove` does not, or how long an
 *    activation lasts. What is tested here is the adapter's response to a
 *    refusal — never the prediction of one.
 *
 *  - HARDWARE. Device changes, output routing, muted system volume, Bluetooth
 *    latency, a browser tab throttled in the background, and the six-context
 *    cap as a THRESHOLD (its mapping is testable via `constructionThrows`; the
 *    limit is not observable outside a browser).
 *
 *  - `AudioBufferSourceNode`, `PeriodicWave`, and anything to do with sample
 *    playback, because the adapter has none. When samples land
 *    (`docs/responsibility.md` § assets — the reference ships no audio files at
 *    all), this file grows and this list shrinks by one.
 */
import type {
  AudioContextStateSurface,
  AudioContextSurface,
  AudioNodeSurface,
  AudioParamSurface,
  GainSurface,
  OscillatorSurface,
  OscillatorWave,
  StereoPannerSurface,
  WebAudioGlobalSurface,
} from '../src/domain/webaudio-surface'

/** How `resume()` behaves. All three happen in real browsers. */
export type ResumePolicy =
  /** The context starts running. */
  | 'allow'
  /**
   * The promise RESOLVES and the context stays suspended.
   *
   * Safari's behaviour, and the one that fools any code trusting the promise
   * instead of re-reading `state`. `WebAudioBackend.unlock` re-reads for this
   * reason and `test/webaudio-adapter.test.ts` pins it with this policy.
   */
  | 'refuse'
  /** The promise REJECTS. Chrome's behaviour with no user activation. */
  | 'reject'

export type FakeWebAudioOptions = {
  /** `false` gives a global with neither constructor: Node, SSR. */
  readonly present?: boolean
  /** `true` exposes only `webkitAudioContext`: Safari before 14.1. */
  readonly prefixed?: boolean
  /** `false` omits `createStereoPanner`, forcing the adapter's mono fallback. */
  readonly stereo?: boolean
  /** The constructor throws. Chrome past its six-context cap. */
  readonly constructionThrows?: boolean
  /** Wiring the master gain throws, i.e. a context that is born broken. */
  readonly wiringThrows?: boolean
  /** Creating a cue's stereo panner throws after its oscillator and gain exist. */
  readonly pannerThrows?: boolean
  readonly resumePolicy?: ResumePolicy
  readonly initialState?: AudioContextStateSurface
}

export type ParamCall = {
  /** The node id, e.g. `gain#2`. */
  readonly node: string
  readonly param: 'gain' | 'frequency' | 'pan'
  readonly kind: 'assign' | 'set' | 'ramp' | 'cancel'
  readonly value: number
  /** The scheduled time. Equal to the virtual `currentTime` for `assign`. */
  readonly atSecs: number
}

export type GraphEdge = {
  readonly from: string
  readonly to: string
}

/** Everything the fake saw, shared by every node of one context. */
export type FakeAudioLog = {
  readonly created: Array<string>
  readonly edges: Array<GraphEdge>
  readonly disconnected: Array<string>
  readonly params: Array<ParamCall>
  readonly started: Array<{ readonly node: string; readonly atSecs: number }>
  readonly stopped: Array<{ readonly node: string; readonly atSecs: number }>
}

/**
 * THE ONE CAST IN THIS FILE, and where it has to be.
 *
 * A handler slot typed `((event: never) => void) | null` cannot be CALLED
 * without a value of type `never`, which is unconstructible. That is not an
 * oversight in `domain/webaudio-surface.ts` — it is forced: `lib.dom` declares
 * these slots as function-typed PROPERTIES, so under `strictFunctionTypes` the
 * parameter is contravariant, and `never` is the only subtype of `Event`
 * writable without `lib.dom`. mc-save's `indexeddb-surface.ts` reaches the same
 * conclusion for `onsuccess` and explains it at length.
 *
 * In a browser nothing ever needs to call these — the DOM does, through the
 * REAL declaration, where the parameter is an `Event`. This fake is standing in
 * for the DOM's dispatcher, so it is the one place in the repository that has
 * to. The cast is confined here and named, rather than spread across the fake
 * as three separate `as never`s that each look like sloppiness.
 *
 * It does NOT weaken the subset proof. That proof is about ASSIGNMENT — a real
 * `OscillatorNode` being assignable to `OscillatorSurface` — and it lives in
 * `test/fixtures/webaudio-surface.ts` compiled against the real `lib.dom.d.ts`.
 * Nothing here participates in it.
 */
const dispatch = (handler: ((event: never) => void) | null): void => {
  handler?.(undefined as never)
}

const emptyLog = (): FakeAudioLog => ({
  created: [],
  edges: [],
  disconnected: [],
  params: [],
  started: [],
  stopped: [],
})

class FakeAudioParam implements AudioParamSurface {
  #value = 0

  constructor(
    private readonly log: FakeAudioLog,
    private readonly node: string,
    private readonly name: ParamCall['param'],
    private readonly clock: () => number,
  ) {}

  get value(): number {
    return this.#value
  }

  set value(next: number) {
    this.#value = next
    this.log.params.push({
      node: this.node,
      param: this.name,
      kind: 'assign',
      value: next,
      atSecs: this.clock(),
    })
  }

  setValueAtTime(value: number, startTime: number): AudioParamSurface {
    this.log.params.push({
      node: this.node,
      param: this.name,
      kind: 'set',
      value,
      atSecs: startTime,
    })
    return this
  }

  linearRampToValueAtTime(value: number, endTime: number): AudioParamSurface {
    this.log.params.push({
      node: this.node,
      param: this.name,
      kind: 'ramp',
      value,
      atSecs: endTime,
    })
    return this
  }

  cancelScheduledValues(cancelTime: number): AudioParamSurface {
    this.log.params.push({
      node: this.node,
      param: this.name,
      kind: 'cancel',
      value: 0,
      atSecs: cancelTime,
    })
    return this
  }
}

class FakeAudioNode implements AudioNodeSurface {
  constructor(
    protected readonly log: FakeAudioLog,
    readonly id: string,
  ) {}

  connect(destination: AudioNodeSurface): AudioNodeSurface {
    // The fake accepts any surface-shaped destination, exactly as the bivariant
    // method signature allows. It records the id when there is one, so a
    // connection to something that is not one of this context's nodes shows up
    // as `?` in the graph rather than being silently accepted and forgotten.
    const target = destination instanceof FakeAudioNode ? destination.id : '?'
    this.log.edges.push({ from: this.id, to: target })
    return destination
  }

  disconnect(): void {
    this.log.disconnected.push(this.id)
  }
}

class FakeGainNode extends FakeAudioNode implements GainSurface {
  readonly gain: AudioParamSurface

  constructor(log: FakeAudioLog, id: string, clock: () => number) {
    super(log, id)
    this.gain = new FakeAudioParam(log, id, 'gain', clock)
  }
}

class FakeStereoPannerNode extends FakeAudioNode implements StereoPannerSurface {
  readonly pan: AudioParamSurface

  constructor(log: FakeAudioLog, id: string, clock: () => number) {
    super(log, id)
    this.pan = new FakeAudioParam(log, id, 'pan', clock)
  }
}

class FakeOscillatorNode extends FakeAudioNode implements OscillatorSurface {
  type: OscillatorWave = 'sine'
  readonly frequency: AudioParamSurface
  onended: ((event: never) => void) | null = null

  /** `null` until `stop` is called; the virtual clock ends the tone. */
  stopAtSecs: number | null = null
  ended = false

  constructor(log: FakeAudioLog, id: string, clock: () => number) {
    super(log, id)
    this.frequency = new FakeAudioParam(log, id, 'frequency', clock)
  }

  start(when?: number): void {
    this.log.started.push({ node: this.id, atSecs: when ?? 0 })
  }

  stop(when?: number): void {
    const at = when ?? 0
    this.stopAtSecs = at
    this.log.stopped.push({ node: this.id, atSecs: at })
  }
}

export class FakeAudioContext implements AudioContextSurface {
  #state: AudioContextStateSurface
  #currentTime = 0
  #nextId = 0

  readonly log: FakeAudioLog = emptyLog()
  readonly destination: AudioNodeSurface
  onstatechange: ((event: never) => void) | null = null

  /** Present only when the fake was built with `stereo` (the default). */
  readonly createStereoPanner?: () => StereoPannerSurface

  readonly oscillators: Array<FakeOscillatorNode> = []

  constructor(
    private readonly options: FakeWebAudioOptions,
    /**
     * Run before anything is built. This is where `makeFakeWebAudio` counts the
     * call and, for `constructionThrows`, throws — so a refused construction
     * increments the counter and registers no context, which is what a real
     * failed `new AudioContext()` leaves behind.
     */
    onConstruct?: () => void,
  ) {
    onConstruct?.()
    this.#state = options.initialState ?? 'suspended'
    this.destination = new FakeAudioNode(this.log, 'destination')

    if (options.stereo !== false) {
      this.createStereoPanner = (): StereoPannerSurface => {
        if (this.options.pannerThrows === true) {
          throw new Error('fake: createStereoPanner refused')
        }
        const node = new FakeStereoPannerNode(this.log, this.#id('panner'), () => this.#currentTime)
        this.log.created.push(node.id)
        return node
      }
    }
  }

  #id(kind: string): string {
    this.#nextId += 1
    return `${kind}#${this.#nextId}`
  }

  get state(): AudioContextStateSurface {
    return this.#state
  }

  get currentTime(): number {
    return this.#currentTime
  }

  createGain(): GainSurface {
    if (this.options.wiringThrows === true && this.log.created.length === 0) {
      throw new Error('fake: createGain refused')
    }
    const node = new FakeGainNode(this.log, this.#id('gain'), () => this.#currentTime)
    this.log.created.push(node.id)
    return node
  }

  createOscillator(): OscillatorSurface {
    const node = new FakeOscillatorNode(this.log, this.#id('osc'), () => this.#currentTime)
    this.log.created.push(node.id)
    this.oscillators.push(node)
    return node
  }

  async resume(): Promise<void> {
    const policy = this.options.resumePolicy ?? 'allow'
    if (policy === 'reject') {
      // A rejection, not a throw before the promise: that is the shape
      // `Effect.tryPromise` has to survive, and the shape the reference
      // swallowed.
      return Promise.reject(new Error('fake: autoplay policy refused resume()'))
    }
    if (policy === 'allow') {
      this.#transition('running')
    }
    // 'refuse' resolves and changes nothing, which is the whole point of it.
    return Promise.resolve()
  }

  async close(): Promise<void> {
    this.#transition('closed')
    return Promise.resolve()
  }

  // -------------------------------------------------------------------------
  // Controls — not part of the surface. A browser offers none of these.
  // -------------------------------------------------------------------------

  /**
   * Advance the virtual audio clock, ending any tone scheduled to stop.
   *
   * This is a SCHEDULE being replayed, not time passing. See the module header
   * on why the difference is stated rather than smoothed over.
   */
  advance(seconds: number): void {
    this.#currentTime += seconds
    for (const oscillator of this.oscillators) {
      if (
        !oscillator.ended &&
        oscillator.stopAtSecs !== null &&
        oscillator.stopAtSecs <= this.#currentTime
      ) {
        oscillator.ended = true
        dispatch(oscillator.onended)
      }
    }
  }

  /** The iOS phone call arriving. */
  interrupt(): void {
    this.#transition('interrupted')
  }

  /** The iOS phone call ending, which a page never asked for and must notice. */
  endInterruption(): void {
    this.#transition('running')
  }

  #transition(next: AudioContextStateSurface): void {
    if (this.#state === next) {
      return
    }
    this.#state = next
    dispatch(this.onstatechange)
  }
}

export type FakeWebAudio = {
  /** Pass this to `makeWebAudioBackend({ global })`. */
  readonly global: WebAudioGlobalSurface
  /** How many times a constructor was invoked. Zero proves laziness. */
  readonly constructorCalls: () => number
  /** The contexts that were successfully constructed, in order. */
  readonly contexts: () => ReadonlyArray<FakeAudioContext>
  /** The most recent context, or `null` if none was ever built. */
  readonly context: () => FakeAudioContext | null
}

/**
 * Build a fake host.
 *
 * The default is the happy path a modern browser presents BEFORE the player has
 * clicked: both constructors' worth of capability, stereo available, and a
 * context that starts `suspended` and will run once `resume()` is called. That
 * default is deliberate — `suspended` is what every player's first page load
 * looks like, so a test that forgets to say otherwise is testing the case that
 * actually happens.
 */
export const makeFakeWebAudio = (options: FakeWebAudioOptions = {}): FakeWebAudio => {
  const contexts: Array<FakeAudioContext> = []
  let calls = 0

  const onConstruct = (): void => {
    calls += 1
    if (options.constructionThrows === true) {
      throw new Error('fake: too many AudioContexts')
    }
  }

  class Constructed extends FakeAudioContext {
    constructor() {
      super(options, onConstruct)
      contexts.push(this)
    }
  }

  const global: WebAudioGlobalSurface =
    options.present === false
      ? // Spelled out rather than `{}`, so a reader sees a host that was
        // CHECKED and found to have no Web Audio, which is Node and SSR.
        { AudioContext: undefined, webkitAudioContext: undefined }
      : options.prefixed === true
        ? { webkitAudioContext: Constructed }
        : { AudioContext: Constructed }

  return {
    global,
    constructorCalls: () => calls,
    contexts: () => contexts,
    context: () => contexts[contexts.length - 1] ?? null,
  }
}

/**
 * @nerima-games/mc-audio — sound cues, music, and captions.
 *
 * mc-audio is tier 1 of the four-tier architecture (plan.md §2.2). It is a
 * sink: mx-gameplay and mx-ui push cue requests in and subscribe to the caption
 * stream, and mc-audio never reaches back into the simulation. If a sound needs
 * to know where the player is, the caller passes the position — which is why
 * everything here runs in Node with no DOM.
 *
 * The one behaviour to know before touching anything: **caption events are
 * emitted before the audio gate is consulted**, so captions appear even when
 * sound cannot play. See `domain/engine.ts` and `test/caption-gate.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * The WebAudio adapter ships, and `lib` was NOT widened to include DOM
 * ---------------------------------------------------------------------------
 *
 * `domain/webaudio-adapter.ts` talks to a real `AudioContext`, and
 * `tsconfig.base.json` still says `lib: ["ES2024"]` and `types: []`. Both are
 * true because `domain/webaudio-surface.ts` describes, structurally, the
 * handful of Web Audio members the adapter uses, and
 * `test/webaudio-surface.test.ts` compiles a fixture against the real
 * `lib.dom.d.ts` to prove a real `AudioContext` satisfies them with no cast.
 *
 * That is what keeps `pnpm typecheck` a PROOF that everything else here is
 * platform-free, and it is why the suite still runs in Node with no jsdom.
 * Read `domain/webaudio-surface.ts` before changing any of it — it also records
 * the fourth `AudioContextState`, `'interrupted'`, which the compiler found and
 * nobody knew about.
 */

export * from './domain/backend-port'
export * from './domain/caption'
export * from './domain/cue'
export * from './domain/engine'
export * from './domain/envelope'
export * from './domain/music'
export * from './domain/volume'
export * from './domain/webaudio-adapter'
export * from './domain/webaudio-surface'
export * from './domain/weather-ambience'
export * from './domain/weather-audio-controller'

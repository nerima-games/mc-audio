/**
 * @nerima-games/mc-audio — sound cues, music, and captions.
 *
 * mc-audio is tier 1 of the four-tier architecture (docs/architecture.md §2). It is a
 * sink: mx-gameplay and mx-ui push cue requests in and subscribe to the caption
 * stream, and mc-audio never reaches back into the simulation. If a sound needs
 * to know where the player is, the caller passes the position — which is why
 * everything here runs in Node with no DOM.
 *
 * The one behaviour to know before touching anything: **caption events are
 * emitted before the audio gate is consulted**, so captions appear even when
 * sound cannot play. See `src/domain/engine.ts` and `test/caption-gate.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * The WebAudio adapter ships, and `lib` was NOT widened to include DOM
 * ---------------------------------------------------------------------------
 *
 * `src/domain/webaudio-adapter.ts` talks to a real `AudioContext`, and
 * `tsconfig.base.json` still says `lib: ["ES2024"]` and `types: []`. Both are
 * true because `src/domain/webaudio-surface.ts` describes, structurally, the
 * handful of Web Audio members the adapter uses, and
 * `test/webaudio-surface.test.ts` compiles a fixture against the real
 * `lib.dom.d.ts` to prove a real `AudioContext` satisfies them with no cast.
 *
 * That is what keeps `pnpm typecheck` a PROOF that everything else here is
 * platform-free, and it is why the suite still runs in Node with no jsdom.
 * Read `src/domain/webaudio-surface.ts` before changing any of it — it also records
 * the fourth `AudioContextState`, `'interrupted'`, which the compiler found and
 * nobody knew about.
 */

export * from './domain/backend-port.js'
export * from './domain/audio-sample.js'
export * from './domain/caption.js'
export * from './domain/cue.js'
export * from './domain/end-audio.js'
export * from './domain/end-audio-controller.js'
export * from './domain/engine.js'
export * from './domain/envelope.js'
export * from './domain/footstep.js'
export * from './domain/game-audio.js'
export * from './domain/music.js'
export * from './domain/minecraft-audio.js'
export * from './domain/minecraft-26-2-sound-data.js'
export * from './domain/minecraft-26-2-sounds.js'
export * from './domain/minecraft-26-3-snapshot-9-sound-data.js'
export * from './domain/minecraft-26-3-snapshot-9-sounds.js'
export * from './domain/minecraft-music.js'
export * from './domain/minecraft-music-player.js'
export * from './domain/minecraft-ambient-sounds.js'
export * from './domain/minecraft-ambient-sounds-player.js'
export * from './domain/minecraft-sounds.js'
export * from './domain/minecraft-mob-sound-variants.js'
export * from './domain/minecraft-sound-player.js'
export * from './domain/free-music-bank.js'
export * from './domain/original-sample-bank.js'
export * from './domain/volume.js'
export * from './domain/webaudio-adapter.js'
export * from './domain/webaudio-surface.js'
export * from './domain/weather-ambience.js'
export * from './domain/weather-audio-controller.js'

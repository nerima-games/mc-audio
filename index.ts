/**
 * @nerima-games/mc-audio — sound cues, music, and captions.
 *
 * PRE-AUDIT FIRST CUT (叩き台). See README.md 現状.
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
 */

export * from './domain/backend-port'
export * from './domain/caption'
export * from './domain/cue'
export * from './domain/engine'
export * from './domain/music'
export * from './domain/volume'

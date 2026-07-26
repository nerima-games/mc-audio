/**
 * The sound cue roster and its registry.
 *
 * PRE-AUDIT FIRST CUT (叩き台). The roster below is a representative subset of
 * the reference implementation's 17 cues
 * (`packages/game/application/sound-manager.types.ts:4-23`), not the full set,
 * and not the final one — the real roster arrives with the gameplay rules that
 * fire the cues.
 *
 * ---------------------------------------------------------------------------
 * Why a literal union rather than opaque ids
 * ---------------------------------------------------------------------------
 *
 * A cue id is part of the shared vocabulary between mx-gameplay, mx-ui and this
 * repository, so it wants exhaustiveness checking: adding a cue should make
 * every `switch` over cues fail to compile until it is handled. The reference
 * got this right and enforced the union/table correspondence with a single
 * line, `SOUND_LIBRARY satisfies Record<SoundEffect, unknown>`
 * (`sound-manager.types.ts:31`).
 *
 * The same technique is used here, in both directions: `CUE_DEFINITIONS` is
 * declared over `Record<SoundCueId, CueDefinition>`, so a cue without a
 * definition is a type error, and `SOUND_CUE_IDS` is derived from the roster, so
 * a definition without a cue is impossible.
 */

export const SOUND_CUE_IDS = [
  'blockBreak',
  'blockPlace',
  'playerHurt',
  'itemPickup',
  'levelUp',
  'footstepGrass',
  'footstepStone',
  'inventoryOpen',
  'inventoryClose',
] as const

export type SoundCueId = (typeof SOUND_CUE_IDS)[number]

const CUE_ID_SET: ReadonlySet<string> = new Set(SOUND_CUE_IDS)

/** Narrow an untrusted string — from a save file, a mod, or a network frame. */
export const isSoundCueId = (value: string): value is SoundCueId => CUE_ID_SET.has(value)

/**
 * What a cue sounds like, and what it says.
 *
 * `baseGain` is per-cue mixing headroom: a footstep and a level-up should not
 * be authored at the same amplitude. It is multiplied by the sfx category
 * volume, never by master (see `domain/volume.ts`).
 *
 * `caption` is `null` for cues that deliberately have no caption. The reference
 * made the same distinction and used it for the two inventory cues
 * (`packages/presentation/hud/sound-captions.ts:11-29`): a UI sound the player
 * just caused by pressing a key does not need to be narrated back to them, and
 * captioning it crowds out the captions that carry information.
 */
export type CueDefinition = {
  readonly baseGain: number
  readonly caption: string | null
  /** Whether the cue is positioned in the world, or a flat UI sound. */
  readonly spatial: boolean
}

export const CUE_DEFINITIONS: Record<SoundCueId, CueDefinition> = {
  blockBreak: { baseGain: 0.4, caption: 'Block broken', spatial: true },
  blockPlace: { baseGain: 0.35, caption: 'Block placed', spatial: true },
  playerHurt: { baseGain: 0.5, caption: 'Player hurt', spatial: false },
  itemPickup: { baseGain: 0.3, caption: 'Item picked up', spatial: false },
  levelUp: { baseGain: 0.45, caption: 'Level up', spatial: false },
  footstepGrass: { baseGain: 0.2, caption: 'Footsteps', spatial: true },
  footstepStone: { baseGain: 0.22, caption: 'Footsteps', spatial: true },
  inventoryOpen: { baseGain: 0.25, caption: null, spatial: false },
  inventoryClose: { baseGain: 0.25, caption: null, spatial: false },
}

export const cueDefinition = (cueId: SoundCueId): CueDefinition => CUE_DEFINITIONS[cueId]

/**
 * Options a caller may attach to a cue.
 *
 * `position` absent means "not spatialised", which is distinct from "spatialised
 * at the listener's own position": the latter would still pan with listener
 * rotation once true 3D panning lands.
 */
export type CuePlayOptions = {
  readonly position?: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
  /** Extra per-call scaling, e.g. a quieter footstep while sneaking. Clamped to >= 0. */
  readonly gainScale?: number
}

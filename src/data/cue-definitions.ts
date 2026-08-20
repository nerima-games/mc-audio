export const SOUND_CUE_IDS = [
  'blockBreak',
  'blockPlace',
  'playerHurt',
  'entityHit',
  'mobHurt',
  'mobDeath',
  'enchant',
  'inventoryOpen',
  'itemPickup',
  'inventoryClose',
  'footstepGrass',
  'footstepStone',
  'footstepWood',
  'rainAmbient',
  'thunderClap',
  'levelUp',
  'achievementUnlock',
] as const

export type SoundCueId = (typeof SOUND_CUE_IDS)[number]

export type CueDefinition = {
  readonly frequency: number
  readonly durationSecs: number
  readonly wave: 'sine' | 'square' | 'sawtooth' | 'triangle'
  readonly baseGain: number
  readonly caption: string | null
  readonly spatial: boolean
}

export const CUE_DEFINITIONS: Record<SoundCueId, CueDefinition> = {
  achievementUnlock: {
    baseGain: 0.42,
    caption: 'Achievement unlocked',
    durationSecs: 0.34,
    frequency: 990,
    spatial: false,
    wave: 'triangle',
  },
  blockBreak: {
    baseGain: 0.4,
    caption: 'Block breaks',
    durationSecs: 0.07,
    frequency: 220,
    spatial: true,
    wave: 'square',
  },
  blockPlace: {
    baseGain: 0.32,
    caption: 'Block placed',
    durationSecs: 0.05,
    frequency: 320,
    spatial: true,
    wave: 'triangle',
  },
  enchant: {
    baseGain: 0.34,
    caption: 'Item enchanted',
    durationSecs: 0.2,
    frequency: 660,
    spatial: false,
    wave: 'triangle',
  },
  entityHit: {
    baseGain: 0.38,
    caption: 'Attack lands',
    durationSecs: 0.09,
    frequency: 280,
    spatial: true,
    wave: 'square',
  },
  footstepGrass: {
    baseGain: 0.18,
    caption: 'Footsteps',
    durationSecs: 0.045,
    frequency: 170,
    spatial: true,
    wave: 'triangle',
  },
  footstepStone: {
    baseGain: 0.16,
    caption: 'Footsteps',
    durationSecs: 0.038,
    frequency: 260,
    spatial: true,
    wave: 'square',
  },
  footstepWood: {
    baseGain: 0.2,
    caption: 'Footsteps',
    durationSecs: 0.048,
    frequency: 210,
    spatial: true,
    wave: 'triangle',
  },
  inventoryClose: {
    baseGain: 0.24,
    caption: null,
    durationSecs: 0.075,
    frequency: 360,
    spatial: false,
    wave: 'triangle',
  },
  inventoryOpen: {
    baseGain: 0.28,
    caption: null,
    durationSecs: 0.085,
    frequency: 520,
    spatial: false,
    wave: 'triangle',
  },
  itemPickup: {
    baseGain: 0.3,
    caption: 'Item picked up',
    durationSecs: 0.055,
    frequency: 840,
    spatial: false,
    wave: 'triangle',
  },
  levelUp: {
    baseGain: 0.4,
    caption: 'Level up!',
    durationSecs: 0.26,
    frequency: 880,
    spatial: false,
    wave: 'triangle',
  },
  mobDeath: {
    baseGain: 0.5,
    caption: 'Mob dies',
    durationSecs: 0.22,
    frequency: 90,
    spatial: true,
    wave: 'sawtooth',
  },
  mobHurt: {
    baseGain: 0.42,
    caption: 'Mob hurts',
    durationSecs: 0.11,
    frequency: 200,
    spatial: true,
    wave: 'sawtooth',
  },
  playerHurt: {
    baseGain: 0.5,
    caption: 'You were hurt',
    durationSecs: 0.12,
    frequency: 140,
    spatial: false,
    wave: 'sawtooth',
  },
  rainAmbient: {
    baseGain: 0.16,
    caption: 'Rain falls',
    durationSecs: 0.32,
    frequency: 120,
    spatial: false,
    wave: 'triangle',
  },
  thunderClap: {
    baseGain: 0.46,
    caption: 'Thunder rumbles',
    durationSecs: 0.65,
    frequency: 55,
    spatial: false,
    wave: 'sawtooth',
  },
}

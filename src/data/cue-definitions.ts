import {
  type AudioDurationSecs,
  type AudioFrequencyHz,
  type AudioGain,
  AudioDurationSecs as makeAudioDurationSecs,
  AudioFrequencyHz as makeAudioFrequencyHz,
  AudioGain as makeAudioGain,
} from '../domain/audio-brands.js'
import { Brand } from 'effect'

const RAW_SOUND_CUE_IDS = [
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

type RawSoundCueId = (typeof RAW_SOUND_CUE_IDS)[number]

export type SoundCueId = RawSoundCueId & Brand.Brand<'SoundCueId'>
export const SoundCueId: Brand.Constructor<SoundCueId> = Brand.make<SoundCueId>((value) => {
  if (RAW_SOUND_CUE_IDS.some((cueId) => cueId === value)) {
    return true
  }
  return 'Unknown sound cue id'
})

const makeSoundCueId = SoundCueId

const SOUND_CUE_ID_ENTRIES: ReadonlyArray<readonly [RawSoundCueId, SoundCueId]> = RAW_SOUND_CUE_IDS.map(
  (rawCueId): readonly [RawSoundCueId, SoundCueId] => [rawCueId, makeSoundCueId(rawCueId)],
)

export const SOUND_CUE_IDS: readonly SoundCueId[] = SOUND_CUE_ID_ENTRIES.map(([, cueId]) => cueId)

export type CueDefinition = {
  readonly frequency: AudioFrequencyHz
  readonly durationSecs: AudioDurationSecs
  readonly wave: 'sine' | 'square' | 'sawtooth' | 'triangle'
  readonly baseGain: AudioGain
  readonly caption: string | null
  readonly spatial: boolean
}

type CueAudioValues = {
  readonly baseGain: number
  readonly durationSecs: number
  readonly frequency: number
}

type CueDefinitionInput = {
  readonly audio: CueAudioValues
  readonly caption: string | null
  readonly spatial: boolean
  readonly wave: CueDefinition['wave']
}

const cue = ({ audio, caption, spatial, wave }: CueDefinitionInput): CueDefinition => ({
  baseGain: makeAudioGain(audio.baseGain),
  caption,
  durationSecs: makeAudioDurationSecs(audio.durationSecs),
  frequency: makeAudioFrequencyHz(audio.frequency),
  spatial,
  wave,
})

const ACHIEVEMENT_UNLOCK_FREQUENCY_HZ = 990
const ACHIEVEMENT_UNLOCK_DURATION_SECS = 0.34
const ACHIEVEMENT_UNLOCK_GAIN = 0.42
const BLOCK_BREAK_FREQUENCY_HZ = 220
const BLOCK_BREAK_DURATION_SECS = 0.07
const BLOCK_BREAK_GAIN = 0.4
const BLOCK_PLACE_FREQUENCY_HZ = 320
const BLOCK_PLACE_DURATION_SECS = 0.05
const BLOCK_PLACE_GAIN = 0.32
const ENCHANT_FREQUENCY_HZ = 660
const ENCHANT_DURATION_SECS = 0.2
const ENCHANT_GAIN = 0.34
const ENTITY_HIT_FREQUENCY_HZ = 280
const ENTITY_HIT_DURATION_SECS = 0.09
const ENTITY_HIT_GAIN = 0.38
const FOOTSTEP_GRASS_FREQUENCY_HZ = 170
const FOOTSTEP_GRASS_DURATION_SECS = 0.045
const FOOTSTEP_GRASS_GAIN = 0.18
const FOOTSTEP_STONE_FREQUENCY_HZ = 260
const FOOTSTEP_STONE_DURATION_SECS = 0.038
const FOOTSTEP_STONE_GAIN = 0.16
const FOOTSTEP_WOOD_FREQUENCY_HZ = 210
const FOOTSTEP_WOOD_DURATION_SECS = 0.048
const FOOTSTEP_WOOD_GAIN = 0.2
const INVENTORY_CLOSE_FREQUENCY_HZ = 360
const INVENTORY_CLOSE_DURATION_SECS = 0.075
const INVENTORY_CLOSE_GAIN = 0.24
const INVENTORY_OPEN_FREQUENCY_HZ = 520
const INVENTORY_OPEN_DURATION_SECS = 0.085
const INVENTORY_OPEN_GAIN = 0.28
const ITEM_PICKUP_FREQUENCY_HZ = 840
const ITEM_PICKUP_DURATION_SECS = 0.055
const ITEM_PICKUP_GAIN = 0.3
const LEVEL_UP_FREQUENCY_HZ = 880
const LEVEL_UP_DURATION_SECS = 0.26
const LEVEL_UP_GAIN = 0.4
const MOB_DEATH_FREQUENCY_HZ = 90
const MOB_DEATH_DURATION_SECS = 0.22
const MOB_DEATH_GAIN = 0.5
const MOB_HURT_FREQUENCY_HZ = 200
const MOB_HURT_DURATION_SECS = 0.11
const MOB_HURT_GAIN = 0.42
const PLAYER_HURT_FREQUENCY_HZ = 140
const PLAYER_HURT_DURATION_SECS = 0.12
const PLAYER_HURT_GAIN = 0.5
const RAIN_AMBIENT_FREQUENCY_HZ = 120
const RAIN_AMBIENT_DURATION_SECS = 0.32
const RAIN_AMBIENT_GAIN = 0.16
const THUNDER_CLAP_FREQUENCY_HZ = 55
const THUNDER_CLAP_DURATION_SECS = 0.65
const THUNDER_CLAP_GAIN = 0.46

export const CUE_DEFINITIONS: Readonly<Record<RawSoundCueId, CueDefinition>> = {
  achievementUnlock: cue({ audio: { baseGain: ACHIEVEMENT_UNLOCK_GAIN, durationSecs: ACHIEVEMENT_UNLOCK_DURATION_SECS, frequency: ACHIEVEMENT_UNLOCK_FREQUENCY_HZ }, caption: 'Achievement unlocked', spatial: false, wave: 'triangle' }),
  blockBreak: cue({ audio: { baseGain: BLOCK_BREAK_GAIN, durationSecs: BLOCK_BREAK_DURATION_SECS, frequency: BLOCK_BREAK_FREQUENCY_HZ }, caption: 'Block breaks', spatial: true, wave: 'square' }),
  blockPlace: cue({ audio: { baseGain: BLOCK_PLACE_GAIN, durationSecs: BLOCK_PLACE_DURATION_SECS, frequency: BLOCK_PLACE_FREQUENCY_HZ }, caption: 'Block placed', spatial: true, wave: 'triangle' }),
  enchant: cue({ audio: { baseGain: ENCHANT_GAIN, durationSecs: ENCHANT_DURATION_SECS, frequency: ENCHANT_FREQUENCY_HZ }, caption: 'Item enchanted', spatial: false, wave: 'triangle' }),
  entityHit: cue({ audio: { baseGain: ENTITY_HIT_GAIN, durationSecs: ENTITY_HIT_DURATION_SECS, frequency: ENTITY_HIT_FREQUENCY_HZ }, caption: 'Attack lands', spatial: true, wave: 'square' }),
  footstepGrass: cue({ audio: { baseGain: FOOTSTEP_GRASS_GAIN, durationSecs: FOOTSTEP_GRASS_DURATION_SECS, frequency: FOOTSTEP_GRASS_FREQUENCY_HZ }, caption: 'Footsteps', spatial: true, wave: 'triangle' }),
  footstepStone: cue({ audio: { baseGain: FOOTSTEP_STONE_GAIN, durationSecs: FOOTSTEP_STONE_DURATION_SECS, frequency: FOOTSTEP_STONE_FREQUENCY_HZ }, caption: 'Footsteps', spatial: true, wave: 'square' }),
  footstepWood: cue({ audio: { baseGain: FOOTSTEP_WOOD_GAIN, durationSecs: FOOTSTEP_WOOD_DURATION_SECS, frequency: FOOTSTEP_WOOD_FREQUENCY_HZ }, caption: 'Footsteps', spatial: true, wave: 'triangle' }),
  inventoryClose: cue({ audio: { baseGain: INVENTORY_CLOSE_GAIN, durationSecs: INVENTORY_CLOSE_DURATION_SECS, frequency: INVENTORY_CLOSE_FREQUENCY_HZ }, caption: null, spatial: false, wave: 'triangle' }),
  inventoryOpen: cue({ audio: { baseGain: INVENTORY_OPEN_GAIN, durationSecs: INVENTORY_OPEN_DURATION_SECS, frequency: INVENTORY_OPEN_FREQUENCY_HZ }, caption: null, spatial: false, wave: 'triangle' }),
  itemPickup: cue({ audio: { baseGain: ITEM_PICKUP_GAIN, durationSecs: ITEM_PICKUP_DURATION_SECS, frequency: ITEM_PICKUP_FREQUENCY_HZ }, caption: 'Item picked up', spatial: false, wave: 'triangle' }),
  levelUp: cue({ audio: { baseGain: LEVEL_UP_GAIN, durationSecs: LEVEL_UP_DURATION_SECS, frequency: LEVEL_UP_FREQUENCY_HZ }, caption: 'Level up!', spatial: false, wave: 'triangle' }),
  mobDeath: cue({ audio: { baseGain: MOB_DEATH_GAIN, durationSecs: MOB_DEATH_DURATION_SECS, frequency: MOB_DEATH_FREQUENCY_HZ }, caption: 'Mob dies', spatial: true, wave: 'sawtooth' }),
  mobHurt: cue({ audio: { baseGain: MOB_HURT_GAIN, durationSecs: MOB_HURT_DURATION_SECS, frequency: MOB_HURT_FREQUENCY_HZ }, caption: 'Mob hurts', spatial: true, wave: 'sawtooth' }),
  playerHurt: cue({ audio: { baseGain: PLAYER_HURT_GAIN, durationSecs: PLAYER_HURT_DURATION_SECS, frequency: PLAYER_HURT_FREQUENCY_HZ }, caption: 'You were hurt', spatial: false, wave: 'sawtooth' }),
  rainAmbient: cue({ audio: { baseGain: RAIN_AMBIENT_GAIN, durationSecs: RAIN_AMBIENT_DURATION_SECS, frequency: RAIN_AMBIENT_FREQUENCY_HZ }, caption: 'Rain falls', spatial: false, wave: 'triangle' }),
  thunderClap: cue({ audio: { baseGain: THUNDER_CLAP_GAIN, durationSecs: THUNDER_CLAP_DURATION_SECS, frequency: THUNDER_CLAP_FREQUENCY_HZ }, caption: 'Thunder rumbles', spatial: false, wave: 'sawtooth' }),
}

export const CUE_DEFINITIONS_BY_ID: Readonly<Record<string, CueDefinition>> = Object.fromEntries(
  SOUND_CUE_ID_ENTRIES.map(([rawCueId, cueId]): readonly [SoundCueId, CueDefinition] => [
    cueId,
    CUE_DEFINITIONS[rawCueId],
  ]),
)

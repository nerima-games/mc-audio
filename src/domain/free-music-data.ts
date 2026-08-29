/* oxlint-disable no-magic-numbers -- These values are the authored musical data for the generated fallback bank. */

export type FreeMusicTrack = {
  readonly eventId: string
  readonly soundId: string
  readonly bpm: number
  readonly notes: readonly number[]
  readonly volume: number
  readonly weight: number
}

export const FREE_MINECRAFT_MUSIC_TRACKS = [
  {
    bpm: 96,
    eventId: 'minecraft:music.free_game',
    notes: [174.61, 220, 261.63, 329.63, 261.63, 220, 196, 220],
    soundId: 'minecraft:music/free_game',
    volume: 1,
    weight: 1,
  },
  {
    bpm: 72,
    eventId: 'minecraft:music.under_water',
    notes: [110, 130.81, 164.81, 146.83, 123.47, 98, 123.47, 146.83],
    soundId: 'minecraft:music/free_underwater',
    volume: 0.4,
    weight: 1,
  },
  {
    bpm: 112,
    eventId: 'minecraft:music.creative',
    notes: [261.63, 329.63, 392, 523.25, 392, 329.63, 293.66, 329.63],
    soundId: 'minecraft:music/free_creative',
    volume: 1,
    weight: 1,
  },
  {
    bpm: 80,
    eventId: 'minecraft:music.free_sulfur_caves',
    notes: [130.81, 155.56, 196, 233.08, 196, 155.56, 146.83, 116.54],
    soundId: 'minecraft:music/free_sulfur_caves',
    volume: 1,
    weight: 1,
  },
  {
    bpm: 88,
    eventId: 'minecraft:music.game',
    notes: [196, 246.94, 293.66, 392, 293.66, 246.94, 220, 246.94],
    soundId: 'minecraft:music/game/shores',
    volume: 0.4,
    weight: 2,
  },
  {
    bpm: 76,
    eventId: 'minecraft:music.game',
    notes: [146.83, 174.61, 220, 261.63, 220, 174.61, 164.81, 130.81],
    soundId: 'minecraft:music/game/memories',
    volume: 0.4,
    weight: 2,
  },
  {
    bpm: 92,
    eventId: 'minecraft:music.overworld.frozen_peaks',
    notes: [220, 277.18, 329.63, 440, 329.63, 277.18, 246.94, 220],
    soundId: 'minecraft:music/game/nightly',
    volume: 0.4,
    weight: 2,
  },
  {
    bpm: 68,
    eventId: 'minecraft:music.overworld.frozen_peaks',
    notes: [123.47, 146.83, 196, 246.94, 196, 146.83, 130.81, 110],
    soundId: 'minecraft:music/game/home',
    volume: 0.4,
    weight: 2,
  },
  {
    bpm: 84,
    eventId: 'minecraft:music.overworld.frozen_peaks',
    notes: [164.81, 196, 246.94, 329.63, 246.94, 196, 174.61, 146.83],
    soundId: 'minecraft:music/game/ebb',
    volume: 0.4,
    weight: 2,
  },
  {
    bpm: 104,
    eventId: 'minecraft:music_disc.bounce',
    notes: [261.63, 329.63, 392, 523.25, 392, 329.63, 261.63, 196],
    soundId: 'minecraft:records/bounce',
    volume: 1,
    weight: 1,
  },
] as const satisfies readonly FreeMusicTrack[]

type OfficialMusicVariant = {
  readonly name: string
  readonly type?: 'sound' | 'event'
  readonly volume?: number
  readonly weight?: number
  readonly stream?: boolean
}

const sound = (name: string, volume = 1, weight = 1): OfficialMusicVariant => ({
  name,
  stream: true,
  volume,
  weight,
})

const event = (name: string): OfficialMusicVariant => ({
  name,
  type: 'event',
})

/*
 * This is the 26.2 music-event shape. The generated bank keeps these event
 * IDs, variant order, weights, volumes, and stream/type metadata while mapping
 * copyrighted source names to the original free samples above.
 */
const MINECRAFT_26_2_MUSIC_EVENTS = {
  'minecraft:music.creative': [
    event('minecraft:music.game'),
    sound('music/game/creative/aria_math'),
    sound('music/game/creative/biome_fest'),
    sound('music/game/creative/blind_spots'),
    sound('music/game/creative/dreiton'),
    sound('music/game/creative/haunt_muskie'),
    sound('music/game/creative/taswell'),
  ],
  'minecraft:music.credits': [sound('music/game/end/alpha')],
  'minecraft:music.dragon': [sound('music/game/end/boss')],
  'minecraft:music.end': [sound('music/game/end/the_end')],
  'minecraft:music.game': [
    sound('music/game/a_familiar_room', 0.4),
    sound('music/game/below_and_above', 0.4),
    sound('music/game/broken_clocks', 0.4),
    sound('music/game/clark'),
    sound('music/game/comforting_memories', 0.4),
    sound('music/game/danny'),
    sound('music/game/dry_hands'),
    sound('music/game/ebb', 0.4, 2),
    sound('music/game/featherfall', 0.4),
    sound('music/game/fireflies', 0.4),
    sound('music/game/floating_dream', 0.4),
    sound('music/game/haggstrom'),
    sound('music/game/home', 0.4, 2),
    sound('music/game/key'),
    sound('music/game/komorebi', 0.8),
    sound('music/game/left_to_bloom', 0.4),
    sound('music/game/lilypad', 0.4),
    sound('music/game/living_mice'),
    sound('music/game/memories', 0.4, 2),
    sound('music/game/mice_on_venus'),
    sound('music/game/minecraft'),
    sound('music/game/nightly', 0.4, 2),
    sound('music/game/one_more_day', 0.4),
    sound('music/game/os_piano', 0.4),
    sound('music/game/oxygene'),
    sound('music/game/puzzlebox', 0.4),
    sound('music/game/shores', 0.4, 2),
    sound('music/game/subwoofer_lullaby'),
    sound('music/game/sweden'),
    sound('music/game/watcher', 0.4),
    sound('music/game/wet_hands'),
    sound('music/game/yakusoku', 0.8),
  ],
  'minecraft:music.menu': [
    sound('music/game/ebb', 0.4, 2),
    sound('music/game/home', 0.4, 2),
    sound('music/game/memories', 0.4, 2),
    sound('music/game/nightly', 0.4, 2),
    sound('music/game/shores', 0.4, 2),
    sound('music/menu/beginning_2'),
    sound('music/menu/floating_trees'),
    sound('music/menu/moog_city_2'),
    sound('music/menu/mutation'),
  ],
  'minecraft:music.nether.basalt_deltas': [
    sound('music/game/nether/ballad_of_the_cats'),
    sound('music/game/nether/concrete_halls'),
    sound('music/game/nether/dead_voxel'),
    sound('music/game/nether/soulsand_valley/so_below', 0.5, 7),
    sound('music/game/nether/warmth'),
  ],
  'minecraft:music.nether.crimson_forest': [
    sound('music/game/nether/ballad_of_the_cats'),
    sound('music/game/nether/concrete_halls'),
    sound('music/game/nether/crimson_forest/chrysopoeia', 0.5, 7),
    sound('music/game/nether/dead_voxel'),
    sound('music/game/nether/warmth'),
  ],
  'minecraft:music.nether.nether_wastes': [
    sound('music/game/nether/ballad_of_the_cats'),
    sound('music/game/nether/concrete_halls'),
    sound('music/game/nether/dead_voxel'),
    sound('music/game/nether/nether_wastes/rubedo', 0.5, 6),
    sound('music/game/nether/warmth'),
  ],
  'minecraft:music.nether.soul_sand_valley': [
    sound('music/game/nether/ballad_of_the_cats'),
    sound('music/game/nether/concrete_halls'),
    sound('music/game/nether/dead_voxel'),
    sound('music/game/nether/soulsand_valley/so_below', 0.5, 7),
    sound('music/game/nether/warmth'),
  ],
  'minecraft:music.nether.warped_forest': [],
  'minecraft:music.overworld.badlands': [
    sound('music/game/crescent_dunes', 0.4),
    sound('music/game/danny'),
    sound('music/game/dry_hands'),
    sound('music/game/echo_in_the_wind', 0.4),
    sound('music/game/featherfall', 0.4),
    sound('music/game/haggstrom'),
    sound('music/game/key'),
    sound('music/game/living_mice'),
    sound('music/game/memories', 0.4, 2),
    sound('music/game/mice_on_venus'),
    sound('music/game/one_more_day', 0.4),
    sound('music/game/oxygene'),
    sound('music/game/subwoofer_lullaby'),
    sound('music/game/wet_hands'),
  ],
  'minecraft:music.overworld.bamboo_jungle': [
    sound('music/game/bromeliad', 0.4),
    sound('music/game/danny'),
    sound('music/game/dry_hands'),
    sound('music/game/haggstrom'),
    sound('music/game/home', 0.4, 2),
    sound('music/game/key'),
    sound('music/game/left_to_bloom', 0.4),
    sound('music/game/living_mice'),
    sound('music/game/mice_on_venus'),
    sound('music/game/oxygene'),
    sound('music/game/subwoofer_lullaby'),
    sound('music/game/wet_hands'),
  ],
  'minecraft:music.overworld.cherry_grove': [
    sound('music/game/below_and_above', 0.4),
    sound('music/game/bromeliad', 0.4),
    sound('music/game/clark'),
    sound('music/game/echo_in_the_wind', 0.4),
    sound('music/game/featherfall', 0.4),
    sound('music/game/home', 0.4, 2),
    sound('music/game/left_to_bloom', 0.4),
    sound('music/game/memories', 0.4, 2),
    sound('music/game/minecraft'),
    sound('music/game/nightly', 0.4, 2),
    sound('music/game/sweden'),
  ],
  'minecraft:music.overworld.deep_dark': [
    sound('music/game/ancestry'),
    sound('music/game/deeper', 0.4),
  ],
  'minecraft:music.overworld.desert': [
    sound('music/game/crescent_dunes', 0.4),
    sound('music/game/danny'),
    sound('music/game/fireflies', 0.4),
    sound('music/game/haggstrom'),
    sound('music/game/key'),
    sound('music/game/living_mice'),
    sound('music/game/memories', 0.4, 2),
    sound('music/game/one_more_day', 0.4),
    sound('music/game/oxygene'),
    sound('music/game/subwoofer_lullaby'),
  ],
  'minecraft:music.overworld.dripstone_caves': [
    sound('music/game/an_ordinary_day'),
    sound('music/game/danny'),
    sound('music/game/deeper', 0.4),
    sound('music/game/ebb', 0.4, 2),
    sound('music/game/eld_unknown', 0.4),
    sound('music/game/endless', 0.4),
    sound('music/game/infinite_amethyst', 0.4),
    sound('music/game/key'),
    sound('music/game/nightly', 1, 2),
    sound('music/game/oxygene'),
    sound('music/game/pokopoko', 0.8),
    sound('music/game/shores', 0.4, 2),
    sound('music/game/subwoofer_lullaby'),
    sound('music/game/wending', 0.4),
  ],
  'minecraft:music.overworld.flower_forest': [
    sound('music/game/bromeliad', 0.4),
    sound('music/game/danny'),
    sound('music/game/echo_in_the_wind', 0.4),
    sound('music/game/featherfall', 0.4),
    sound('music/game/haggstrom'),
    sound('music/game/key'),
    sound('music/game/left_to_bloom', 0.4),
    sound('music/game/living_mice'),
    sound('music/game/memories', 0.4, 2),
    sound('music/game/oxygene'),
    sound('music/game/shores', 0.4, 2),
    sound('music/game/subwoofer_lullaby'),
  ],
  'minecraft:music.overworld.forest': [
    sound('music/game/broken_clocks', 0.4),
    sound('music/game/bromeliad', 0.4),
    sound('music/game/clark'),
    sound('music/game/comforting_memories', 0.4),
    sound('music/game/danny'),
    sound('music/game/dry_hands'),
    sound('music/game/floating_dream', 0.4),
    sound('music/game/haggstrom'),
    sound('music/game/key'),
    sound('music/game/left_to_bloom', 0.4),
    sound('music/game/living_mice'),
    sound('music/game/memories', 0.4, 2),
    sound('music/game/mice_on_venus'),
    sound('music/game/minecraft'),
    sound('music/game/one_more_day', 0.4),
    sound('music/game/oxygene'),
    sound('music/game/shores', 0.4, 2),
    sound('music/game/subwoofer_lullaby'),
    sound('music/game/swamp/aerie', 0.4),
    sound('music/game/swamp/firebugs', 0.4),
    sound('music/game/swamp/labyrinthine', 0.4),
    sound('music/game/sweden'),
    sound('music/game/wet_hands'),
  ],
  'minecraft:music.overworld.frozen_peaks': [
    sound('music/game/danny'),
    sound('music/game/dry_hands'),
    sound('music/game/ebb', 0.4, 2),
    sound('music/game/haggstrom'),
    sound('music/game/home', 0.4, 2),
    sound('music/game/lilypad', 0.4),
    sound('music/game/living_mice'),
    sound('music/game/mice_on_venus'),
    sound('music/game/nightly', 0.4, 2),
    sound('music/game/stand_tall', 0.4),
    sound('music/game/subwoofer_lullaby'),
    sound('music/game/wet_hands'),
  ],
  'minecraft:music.overworld.grove': [
    sound('music/game/clark'),
    sound('music/game/comforting_memories', 0.4),
    sound('music/game/eld_unknown', 0.4),
    sound('music/game/endless', 0.4),
    sound('music/game/infinite_amethyst', 0.4),
    sound('music/game/key'),
    sound('music/game/lilypad', 0.4),
    sound('music/game/mice_on_venus'),
    sound('music/game/minecraft'),
    sound('music/game/oxygene'),
    sound('music/game/pokopoko', 0.8),
    sound('music/game/shores', 0.4, 2),
    sound('music/game/sweden'),
    sound('music/game/wending', 0.4),
  ],
  'minecraft:music.overworld.jagged_peaks': [
    sound('music/game/dry_hands'),
    sound('music/game/ebb', 0.4, 2),
    sound('music/game/eld_unknown', 0.4),
    sound('music/game/endless', 0.4),
    sound('music/game/floating_dream', 0.4),
    sound('music/game/key'),
    sound('music/game/living_mice'),
    sound('music/game/mice_on_venus'),
    sound('music/game/nightly', 0.4, 2),
    sound('music/game/oxygene'),
    sound('music/game/pokopoko', 0.8),
    sound('music/game/stand_tall', 0.4),
    sound('music/game/subwoofer_lullaby'),
    sound('music/game/wending', 0.4),
    sound('music/game/wet_hands'),
  ],
  'minecraft:music.overworld.jungle': [
    sound('music/game/bromeliad', 0.4),
    sound('music/game/danny'),
    sound('music/game/dry_hands'),
    sound('music/game/haggstrom'),
    sound('music/game/home', 0.4, 2),
    sound('music/game/key'),
    sound('music/game/left_to_bloom', 0.4),
    sound('music/game/living_mice'),
    sound('music/game/mice_on_venus'),
    sound('music/game/oxygene'),
    sound('music/game/subwoofer_lullaby'),
    sound('music/game/wet_hands'),
  ],
  'minecraft:music.overworld.lush_caves': [
    sound('music/game/an_ordinary_day', 0.8),
    sound('music/game/clark'),
    sound('music/game/echo_in_the_wind', 0.4),
    sound('music/game/featherfall', 0.4),
    sound('music/game/floating_dream', 0.5),
    sound('music/game/left_to_bloom', 0.4),
    sound('music/game/mice_on_venus'),
    sound('music/game/minecraft'),
    sound('music/game/one_more_day', 0.4),
    sound('music/game/os_piano', 0.4),
    sound('music/game/shores', 0.4, 2),
    sound('music/game/swamp/aerie', 0.4),
    sound('music/game/swamp/firebugs', 0.4),
    sound('music/game/swamp/labyrinthine', 0.4),
    sound('music/game/sweden'),
  ],
  'minecraft:music.overworld.meadow': [
    sound('music/game/danny'),
    sound('music/game/haggstrom'),
    sound('music/game/home', 0.4, 2),
    sound('music/game/left_to_bloom', 0.4),
    sound('music/game/living_mice'),
    sound('music/game/one_more_day', 0.4, 2),
    sound('music/game/subwoofer_lullaby'),
  ],
  'minecraft:music.overworld.old_growth_taiga': [
    sound('music/game/clark'),
    sound('music/game/comforting_memories', 0.4),
    sound('music/game/danny'),
    sound('music/game/dry_hands'),
    sound('music/game/floating_dream', 0.4),
    sound('music/game/haggstrom'),
    sound('music/game/key'),
    sound('music/game/left_to_bloom', 0.4),
    sound('music/game/living_mice'),
    sound('music/game/mice_on_venus'),
    sound('music/game/minecraft'),
    sound('music/game/one_more_day', 0.4),
    sound('music/game/oxygene'),
    sound('music/game/shores', 0.4, 2),
    sound('music/game/subwoofer_lullaby'),
    sound('music/game/swamp/aerie', 0.4),
    sound('music/game/swamp/firebugs', 0.4),
    sound('music/game/swamp/labyrinthine', 0.4),
    sound('music/game/sweden'),
    sound('music/game/wet_hands'),
  ],
  'minecraft:music.overworld.snowy_slopes': [
    sound('music/game/an_ordinary_day', 0.4),
    sound('music/game/haggstrom'),
    sound('music/game/living_mice'),
    sound('music/game/nightly', 0.4, 2),
    sound('music/game/one_more_day', 0.4),
    sound('music/game/pokopoko', 0.8),
    sound('music/game/stand_tall', 0.4),
    sound('music/game/subwoofer_lullaby'),
  ],
  'minecraft:music.overworld.sparse_jungle': [
    sound('music/game/bromeliad', 0.4),
    sound('music/game/danny'),
    sound('music/game/dry_hands'),
    sound('music/game/haggstrom'),
    sound('music/game/home', 0.4, 2),
    sound('music/game/key'),
    sound('music/game/left_to_bloom', 0.4),
    sound('music/game/living_mice'),
    sound('music/game/mice_on_venus'),
    sound('music/game/oxygene'),
    sound('music/game/subwoofer_lullaby'),
    sound('music/game/wet_hands'),
  ],
  'minecraft:music.overworld.stony_peaks': [
    sound('music/game/danny'),
    sound('music/game/dry_hands'),
    sound('music/game/eld_unknown', 0.4),
    sound('music/game/endless', 0.4),
    sound('music/game/haggstrom'),
    sound('music/game/living_mice'),
    sound('music/game/mice_on_venus'),
    sound('music/game/nightly', 0.4, 2),
    sound('music/game/stand_tall', 0.4),
    sound('music/game/subwoofer_lullaby'),
    sound('music/game/wending', 0.4),
    sound('music/game/wet_hands'),
  ],
  'minecraft:music.overworld.sulfur_caves': [
    sound('music/game/an_ordinary_day'),
    sound('music/game/danny'),
    sound('music/game/deeper', 0.4),
    sound('music/game/ebb', 0.4, 2),
    sound('music/game/eld_unknown', 0.4),
    sound('music/game/endless', 0.4),
    sound('music/game/infinite_amethyst', 0.4),
    sound('music/game/key'),
    sound('music/game/nightly', 1, 2),
    sound('music/game/oxygene'),
    sound('music/game/pokopoko', 0.8),
    sound('music/game/shores', 0.4, 2),
    sound('music/game/subwoofer_lullaby'),
    sound('music/game/wending', 0.4),
  ],
  'minecraft:music.overworld.swamp': [
    sound('music/game/ebb', 0.4),
    sound('music/game/swamp/aerie', 0.4),
    sound('music/game/swamp/firebugs', 0.4),
    sound('music/game/swamp/labyrinthine', 0.4),
  ],
  'minecraft:music.under_water': [
    sound('music/game/water/axolotl', 0.4),
    sound('music/game/water/dragon_fish', 0.4),
    sound('music/game/water/shuniji', 0.4),
  ],
  'minecraft:music_disc.11': [sound('records/11')],
  'minecraft:music_disc.13': [sound('records/13')],
  'minecraft:music_disc.5': [sound('records/5')],
  'minecraft:music_disc.blocks': [sound('records/blocks')],
  'minecraft:music_disc.bounce': [sound('records/bounce')],
  'minecraft:music_disc.cat': [sound('records/cat')],
  'minecraft:music_disc.chirp': [sound('records/chirp')],
  'minecraft:music_disc.creator': [sound('records/creator')],
  'minecraft:music_disc.creator_music_box': [sound('records/creator_music_box')],
  'minecraft:music_disc.far': [sound('records/far')],
  'minecraft:music_disc.lava_chicken': [sound('records/lava_chicken')],
  'minecraft:music_disc.mall': [sound('records/mall')],
  'minecraft:music_disc.mellohi': [sound('records/mellohi')],
  'minecraft:music_disc.otherside': [sound('records/otherside')],
  'minecraft:music_disc.pigstep': [sound('records/pigstep')],
  'minecraft:music_disc.precipice': [sound('records/precipice')],
  'minecraft:music_disc.relic': [sound('records/relic')],
  'minecraft:music_disc.stal': [sound('records/stal')],
  'minecraft:music_disc.strad': [sound('records/strad')],
  'minecraft:music_disc.tears': [sound('records/tears')],
  'minecraft:music_disc.wait': [sound('records/wait')],
  'minecraft:music_disc.ward': [sound('records/ward')],
} as const satisfies Readonly<Record<string, readonly OfficialMusicVariant[]>>

const FREE_MUSIC_EVENTS = {
  'minecraft:music.free_game': [sound('music/free_game')],
  'minecraft:music.free_sulfur_caves': [sound('music/free_sulfur_caves')],
} as const satisfies Readonly<Record<string, readonly OfficialMusicVariant[]>>

const ALL_MUSIC_EVENTS = {
  ...MINECRAFT_26_2_MUSIC_EVENTS,
  ...FREE_MUSIC_EVENTS,
} as const satisfies Readonly<Record<string, readonly OfficialMusicVariant[]>>

const FREE_GAME_SOUND_ID = 'minecraft:music/free_game'
const FREE_UNDERWATER_SOUND_ID = 'minecraft:music/free_underwater'
const FREE_CREATIVE_SOUND_ID = 'minecraft:music/free_creative'
const FREE_SULFUR_CAVES_SOUND_ID = 'minecraft:music/free_sulfur_caves'
const FREE_BOUNCE_SOUND_ID = 'minecraft:records/bounce'

const namespaced = (name: string): string => {
  if (name.includes(':')) {
    return name
  }
  return `minecraft:${name}`
}

const DIRECT_FREE_SOUND_IDS = new Set([
  'minecraft:music/game/ebb',
  'minecraft:music/game/home',
  'minecraft:music/game/memories',
  'minecraft:music/game/nightly',
  'minecraft:music/game/shores',
  FREE_BOUNCE_SOUND_ID,
])

const freeSoundIdForEvent = (eventId: string): string => {
  if (eventId === 'minecraft:music.creative') {
    return FREE_CREATIVE_SOUND_ID
  }
  if (eventId === 'minecraft:music.under_water') {
    return FREE_UNDERWATER_SOUND_ID
  }
  if (eventId.startsWith('minecraft:music_disc.')) {
    return FREE_BOUNCE_SOUND_ID
  }
  if (eventId.startsWith('minecraft:music.nether.') || eventId === 'minecraft:music.free_sulfur_caves') {
    return FREE_SULFUR_CAVES_SOUND_ID
  }
  return FREE_GAME_SOUND_ID
}

const freeSoundIdFor = (eventId: string, name: string): string => {
  const normalizedName = namespaced(name)
  if (DIRECT_FREE_SOUND_IDS.has(normalizedName)) {
    return normalizedName
  }
  return freeSoundIdForEvent(eventId)
}

export type FreeMusicEventVariant = {
  readonly soundId: string
  readonly type: 'sound' | 'event'
  readonly volume: number
  readonly weight: number
  readonly stream: boolean
}

const freeSoundIdForVariant = (eventId: string, variant: OfficialMusicVariant): string => {
  if (variant.type === 'event') {
    return namespaced(variant.name)
  }
  return freeSoundIdFor(eventId, variant.name)
}

const mapMusicEventVariant = (eventId: string, variant: OfficialMusicVariant): FreeMusicEventVariant => ({
  soundId: freeSoundIdForVariant(eventId, variant),
  stream: variant.stream ?? false,
  type: variant.type ?? 'sound',
  volume: variant.volume ?? 1,
  weight: variant.weight ?? 1,
})

const mapMusicEvents = <Table extends Readonly<Record<string, readonly OfficialMusicVariant[]>>>(
  table: Table,
): { readonly [Key in keyof Table]: readonly FreeMusicEventVariant[] } => Object.fromEntries(
  Object.entries(table).map(([eventId, variants]) => [
    eventId,
    variants.map((variant) => mapMusicEventVariant(eventId, variant)),
  ]),
) as unknown as { readonly [Key in keyof Table]: readonly FreeMusicEventVariant[] }

/**
 * A free fallback with the complete 26.2 music event topology. Only the
 * generated sample names differ from the official sounds.json entries.
 */
export const FREE_MINECRAFT_MUSIC_EVENT_VARIANTS = mapMusicEvents(ALL_MUSIC_EVENTS)

export type FreeMusicEventId = keyof typeof FREE_MINECRAFT_MUSIC_EVENT_VARIANTS


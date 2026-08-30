import { MINECRAFT_26_2_SOUNDS_JSON } from './minecraft-26-2-sound-data.js'
import type { MinecraftSoundRegistry } from './minecraft-sounds-types.js'
import { parseMinecraftSoundsJson } from './minecraft-sounds-parser.js'

export { MINECRAFT_26_2_SOUNDS_JSON }

type Minecraft26_2SoundKey = Extract<keyof typeof MINECRAFT_26_2_SOUNDS_JSON, string>

export type Minecraft26_2SoundEventId = `minecraft:${Minecraft26_2SoundKey}`

const SOUND_EVENT_KEYS = Object.keys(MINECRAFT_26_2_SOUNDS_JSON) as readonly Minecraft26_2SoundKey[]

const namespacedSoundEventId = (key: Minecraft26_2SoundKey): Minecraft26_2SoundEventId =>
  `minecraft:${key}`

const eventIdsWithPrefix = (prefix: string): readonly Minecraft26_2SoundEventId[] =>
  SOUND_EVENT_KEYS.filter((key) => key.startsWith(`${prefix}.`)).map(namespacedSoundEventId)

export const MINECRAFT_26_2_SOUND_EVENT_IDS: readonly Minecraft26_2SoundEventId[] =
  SOUND_EVENT_KEYS.map(namespacedSoundEventId)

export const MINECRAFT_26_2_SOUND_EVENT_GROUPS: {
  readonly ambient: readonly Minecraft26_2SoundEventId[]
  readonly blocks: readonly Minecraft26_2SoundEventId[]
  readonly enchant: readonly Minecraft26_2SoundEventId[]
  readonly entities: readonly Minecraft26_2SoundEventId[]
  readonly events: readonly Minecraft26_2SoundEventId[]
  readonly items: readonly Minecraft26_2SoundEventId[]
  readonly music: readonly Minecraft26_2SoundEventId[]
  readonly musicDiscs: readonly Minecraft26_2SoundEventId[]
  readonly particles: readonly Minecraft26_2SoundEventId[]
  readonly ui: readonly Minecraft26_2SoundEventId[]
  readonly weather: readonly Minecraft26_2SoundEventId[]
} = {
  ambient: eventIdsWithPrefix('ambient'),
  blocks: eventIdsWithPrefix('block'),
  enchant: eventIdsWithPrefix('enchant'),
  entities: eventIdsWithPrefix('entity'),
  events: eventIdsWithPrefix('event'),
  items: eventIdsWithPrefix('item'),
  music: eventIdsWithPrefix('music'),
  musicDiscs: eventIdsWithPrefix('music_disc'),
  particles: eventIdsWithPrefix('particle'),
  ui: eventIdsWithPrefix('ui'),
  weather: eventIdsWithPrefix('weather'),
} as const

export const createMinecraft26_2SoundRegistry = (): MinecraftSoundRegistry =>
  parseMinecraftSoundsJson(MINECRAFT_26_2_SOUNDS_JSON, { namespace: 'minecraft' })

export const missingMinecraft26_2SoundEvents = (
  registry: MinecraftSoundRegistry,
): readonly Minecraft26_2SoundEventId[] =>
  MINECRAFT_26_2_SOUND_EVENT_IDS.filter((eventId) => !Object.hasOwn(registry.events, eventId))


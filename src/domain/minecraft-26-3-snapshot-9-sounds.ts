import { MINECRAFT_26_3_SNAPSHOT_9_SOUNDS_JSON } from './minecraft-26-3-snapshot-9-sound-data.js'
import type { MinecraftSoundRegistry } from './minecraft-sounds-types.js'
import { parseMinecraftSoundsJson } from './minecraft-sounds-parser.js'

export { MINECRAFT_26_3_SNAPSHOT_9_SOUNDS_JSON }

type Minecraft26_3Snapshot9SoundKey = Extract<keyof typeof MINECRAFT_26_3_SNAPSHOT_9_SOUNDS_JSON, string>

export type Minecraft26_3Snapshot9SoundEventId = `minecraft:${Minecraft26_3Snapshot9SoundKey}`

const SOUND_EVENT_KEYS = Object.keys(MINECRAFT_26_3_SNAPSHOT_9_SOUNDS_JSON) as readonly Minecraft26_3Snapshot9SoundKey[]

const namespacedSoundEventId = (key: Minecraft26_3Snapshot9SoundKey): Minecraft26_3Snapshot9SoundEventId =>
  `minecraft:${key}`

const eventIdsWithPrefix = (prefix: string): readonly Minecraft26_3Snapshot9SoundEventId[] =>
  SOUND_EVENT_KEYS.filter((key) => key.startsWith(`${prefix}.`)).map(namespacedSoundEventId)

export const MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_IDS: readonly Minecraft26_3Snapshot9SoundEventId[] =
  SOUND_EVENT_KEYS.map(namespacedSoundEventId)

export const MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_GROUPS: {
  readonly ambient: readonly Minecraft26_3Snapshot9SoundEventId[]
  readonly blocks: readonly Minecraft26_3Snapshot9SoundEventId[]
  readonly enchant: readonly Minecraft26_3Snapshot9SoundEventId[]
  readonly entities: readonly Minecraft26_3Snapshot9SoundEventId[]
  readonly events: readonly Minecraft26_3Snapshot9SoundEventId[]
  readonly items: readonly Minecraft26_3Snapshot9SoundEventId[]
  readonly music: readonly Minecraft26_3Snapshot9SoundEventId[]
  readonly musicDiscs: readonly Minecraft26_3Snapshot9SoundEventId[]
  readonly particles: readonly Minecraft26_3Snapshot9SoundEventId[]
  readonly ui: readonly Minecraft26_3Snapshot9SoundEventId[]
  readonly weather: readonly Minecraft26_3Snapshot9SoundEventId[]
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

export const createMinecraft26_3Snapshot9SoundRegistry = (): MinecraftSoundRegistry =>
  parseMinecraftSoundsJson(MINECRAFT_26_3_SNAPSHOT_9_SOUNDS_JSON, { namespace: 'minecraft' })

export const missingMinecraft26_3Snapshot9SoundEvents = (
  registry: MinecraftSoundRegistry,
): readonly Minecraft26_3Snapshot9SoundEventId[] =>
  MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_IDS.filter((eventId) => !Object.hasOwn(registry.events, eventId))

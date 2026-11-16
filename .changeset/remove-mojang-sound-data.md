---
"@nerima-games/mc-audio": minor
---

Remove every value copied from Mojang's `sounds.json`. The package no longer ships a vanilla sound-event catalogue or the free-music bank, whose music event table reproduced vanilla event IDs, variant order, weights, volumes, and track names. The package and source tree now contain no data copied from a Mojang distribution. Hosts that want the `sounds.json` path supply their own data to `parseMinecraftSoundsJson`.

Removed runtime exports:

- `MINECRAFT_26_2_SOUNDS_JSON`, `MINECRAFT_26_2_SOUND_EVENT_IDS`, `MINECRAFT_26_2_SOUND_EVENT_GROUPS`, `createMinecraft26_2SoundRegistry`, `missingMinecraft26_2SoundEvents`
- `MINECRAFT_26_3_SNAPSHOT_9_SOUNDS_JSON`, `MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_IDS`, `MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_GROUPS`, `createMinecraft26_3Snapshot9SoundRegistry`, `missingMinecraft26_3Snapshot9SoundEvents`
- `FREE_MINECRAFT_MUSIC_TRACKS`, `FREE_MINECRAFT_MUSIC_EVENT_VARIANTS`, `FREE_MUSIC_SAMPLE_RATE`, `FREE_MUSIC_DURATION_SECS`, `createFreeMinecraftMusicManifest`, `createFreeMinecraftMusicPack`, `createFreeMinecraftMusicRegistry`, `generateFreeMusicWav`
- `AudioBpm`, `AudioNote` (brand constructors used only by the free-music bank)

Removed type exports:

- `Minecraft26_2SoundEventId`, `Minecraft26_2SoundDefinition`, `Minecraft26_2SoundVariantDefinition`
- `Minecraft26_3Snapshot9SoundEventId`, `Minecraft26_3Snapshot9SoundDefinition`, `Minecraft26_3Snapshot9SoundVariantDefinition`
- `FreeMusicTrack`, `FreeMusicEventId`, `FreeMusicEventVariant`, `FreeMusicBankFailure`, `FreeMusicBankOptions`, `FreeMinecraftMusicPack`
- `AudioBpm`, `AudioNote` (brand types)

The `import:minecraft-sounds` and `import:minecraft-26-3-snapshot-9` package scripts are removed with their import scripts.

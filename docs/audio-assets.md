# Audio asset manifests

`AudioAssetManifest` maps the existing `SoundCueId` values to licensed effect recordings. `MusicScenePlaylistManifest` maps music scenes to licensed tracks. This change adds no recordings or offline asset-generation scripts; the existing procedural music bank remains the playback fallback.

## Cue recordings and attribution

Each cue variant has a relative `file` path, `volume`, `pitchRange`, and `attribution`. External attribution records the author, work, source page, license, and whether the file was modified. Generated attribution records the generator script and repository license.

```json
{
  "blockBreak": [
    {
      "file": "audio/effects/block-break.ogg",
      "volume": 0.8,
      "pitchRange": { "minimum": 0.9, "maximum": 1.1 },
      "attribution": {
        "type": "external",
        "author": "Kenney",
        "workTitle": "Impact Sounds",
        "sourceUrl": "https://kenney.nl/assets/impact-sounds",
        "licenseName": "CC0 1.0 Universal",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        "modified": false
      }
    },
    {
      "file": "audio/effects/block-break-generated.ogg",
      "volume": 1,
      "pitchRange": { "minimum": 1, "maximum": 1.2 },
      "attribution": {
        "type": "generated",
        "generatorScript": "scripts/audio/generate-cues.ts",
        "licenseSpdx": "MIT",
        "licenseName": "MIT License",
        "licenseFile": "LICENSE",
        "licenseUrl": "https://opensource.org/license/MIT"
      }
    }
  ]
}
```

The `file` values are project-relative destinations for imported or generated audio. Replace them with the files selected by the asset stream. This CC0 example assumes the sound is unmodified; set `modified` to match any conversion or editing. The cue manifest accepts only registered `SoundCueId` keys. `{}` is valid and leaves cues on their procedural fallback path.

Decode untrusted JSON with `decodeAudioAssetManifest`. It returns a typed `Result` for unknown cues, missing fields, invalid URLs, unsafe paths, and invalid numbers.

```ts
import { Result } from 'effect'
import { decodeAudioAssetManifest } from '@nerima-games/mc-audio'

const decoded = decodeAudioAssetManifest(input)
const outcome = Result.match(decoded, {
  onFailure: ({ path, message }) => `Invalid audio manifest at ${path}: ${message}`,
  onSuccess: (manifest) => `Decoded ${Object.keys(manifest).length} cue entries`,
})
```

File paths cannot be absolute, contain traversal segments, or include query and fragment text. Attribution URLs must be credential-free HTTP or HTTPS URLs. `volume` ranges from 0 through 1. `pitchRange` endpoints range from 0.5 through 2, and the minimum cannot exceed the maximum.

## Music scene playlists

The music manifest uses the same attribution union. Each scene has a non-empty `tracks` array, a silence interval between completed tracks, and a crossfade duration for scene changes. The decoder accepts these nine scene keys: `title`, `day`, `night`, `cave`, `nether`, `end`, `combat`, `underwater`, and `creative`. Track `eventId` values must use the reserved `mc-audio:music/` prefix so they cannot collide with vanilla context fallback events. The playlist registry marks its events as replacements, so each selected track resolves to its file after merging with the fallback registry.

This TypeScript example builds a manifest the decoder accepts. It uses repository-generated tracks and repeats the repository's MIT license data for every track. The paths are destinations for the later music generation stream; this package does not include those files or the script.

```ts
import { Result } from 'effect'
import {
  decodeMusicScenePlaylistManifest,
  mergeAudioSampleManifests,
  mergeSoundRegistries,
  musicScenePlaylistRegistry,
  musicScenePlaylistSampleManifest,
} from '@nerima-games/mc-audio'

const generatedAttribution = {
  type: 'generated',
  generatorScript: 'scripts/audio/generate-music.ts',
  licenseSpdx: 'MIT',
  licenseName: 'MIT License',
  licenseFile: 'LICENSE',
  licenseUrl: 'https://opensource.org/license/MIT',
} as const

const track = (id: string) => ({
  eventId: `mc-audio:music/${id}`,
  file: `audio/music/${id}.ogg`,
  attribution: generatedAttribution,
})

const playlist = (...tracks: ReadonlyArray<ReturnType<typeof track>>) => ({
  crossfadeTicks: 40,
  maximumSilenceTicks: 4800,
  minimumSilenceTicks: 2400,
  tracks,
})

const scenePlaylists = {
  title: playlist(track('title/main')),
  day: playlist(track('day/01'), track('day/02')),
  night: playlist(track('night/main')),
  cave: playlist(track('cave/main')),
  nether: playlist(track('nether/main')),
  end: playlist(track('end/main')),
  combat: playlist(track('combat/main')),
  underwater: playlist(track('underwater/main')),
  creative: playlist(track('creative/main')),
}

const decodedMusic = decodeMusicScenePlaylistManifest(scenePlaylists)
if (Result.isSuccess(decodedMusic)) {
  const manifest = decodedMusic.success
  const registry = mergeSoundRegistries(existingMusicRegistry, musicScenePlaylistRegistry(manifest))
  const sampleManifest = mergeAudioSampleManifests(existingSampleManifest, musicScenePlaylistSampleManifest(manifest))
}
```

`existingMusicRegistry` and `existingSampleManifest` are the host's current music maps, including its procedural fallback tracks. The registry merge applies the scene registry as an overlay; the sample merge keeps existing sample IDs on collisions.

On failure, handle `decodedMusic.failure` before using the manifest. Inside the success branch, pass `manifest` to the registry and sample helpers, then to `player.tick` as `scenePlaylists`.

`crossfadeTicks` must be an integer from 1 through 200. `minimumSilenceTicks` must be an integer from 1 through 24,000, and `maximumSilenceTicks` must be at least the minimum and no greater than 24,000. An `eventId` cannot map to different file or attribution values. It may recur across scenes when that mapping is identical.

`decodeMusicScenePlaylistManifest` returns a typed `Result`; check it before using the manifest. Pass its success value to `musicScenePlaylistSampleManifest` and `musicScenePlaylistRegistry`. The sample manifest uses the track's relative `file` path as its sample URL. `loadSampleData` receives that path as an `AudioSampleUrl`, and the host resolves it against its resource pack, base URL, or asset store. Pass the scene and manifest to `player.tick({ context, scene, scenePlaylists, musicVolume })`. `musicVolume` controls BGM independently from the effect volume.

Merge `musicScenePlaylistRegistry(manifest)` into the host's existing music registry with `mergeSoundRegistries(existingRegistry, musicScenePlaylistRegistry(manifest))`. Merge `musicScenePlaylistSampleManifest(manifest)` into the host's existing sample map with `mergeAudioSampleManifests(existingSamples, musicScenePlaylistSampleManifest(manifest))`. Keep the existing generated-track registry available as the procedural fallback. A failed or timed-out BGM asset read or decode is recorded in `backend.report.sampleLoadFailures` with its file and reason; only that asset-load refusal selects the procedural track. Context unavailable or locked and capacity refusals remain playback failures and do not select the fallback.

Call `audioAssetCredits` for cue attribution and `musicScenePlaylistCredits` for music attribution. Both return distinct rows for credits and distribution notices. Generated rows include the generator path, SPDX identifier, license name, repository `LICENSE` path, and canonical license URL. External rows include the author, work title, source page, and license details.

## Loading and cue playback

Pass the decoded cue manifest to `makeWebAudioBackend` as `audioAssetManifest` and provide the host-owned `loadSampleData` path transport. Cue files are marked for preload and start loading when the backend first creates its audio context, which happens during game startup or the first audio operation. `backend.preloadAudioAssets` can also preload them explicitly and returns an `Effect.Effect<AudioAssetLoadReport>` with aggregate sample counts and typed `AudioAssetLoadFailure` entries naming failed cue files.

Cue playback waits up to `DEFAULT_EFFECT_SAMPLE_LOAD_TIMEOUT_MS` (250 ms). This short budget lets a slow cue use its synthesized fallback promptly instead of queuing a stale footstep or other event. Shared cue loads can continue up to `DEFAULT_SAMPLE_LOAD_TIMEOUT_MS` (15,000 ms), allowing startup preloads to warm assets for later events. This is also the total operation limit for music and other sample-manifest entries. Set `effectSampleLoadTimeoutMs` to change the cue playback wait or `sampleLoadTimeoutMs` to change the full load limit. Zero expires immediately. The full load limit covers the complete operation, including a streamed preload attempt followed by a decoded-file fallback. Invalid negative or non-finite values from untyped callers appear as `invalid-timeout` failures instead of using the default. Rejected reads, failed decodes, and timeouts appear by file in `backend.report.sampleLoadFailures`; cue-specific entries also appear in `audioAssetFailures`. A Promise-based host can evaluate the report with `Effect.runPromise(backend.report)`.

The registered cue IDs are `blockBreak`, `blockPlace`, `playerHurt`, `entityHit`, `mobHurt`, `mobDeath`, `enchant`, `inventoryOpen`, `itemPickup`, `inventoryClose`, `footstepDefault`, `footstepGrass`, `footstepStone`, `footstepWood`, `rainAmbient`, `thunderClap`, `levelUp`, and `achievementUnlock`. The source of truth is [`src/data/cue-definitions.ts`](../src/data/cue-definitions.ts).

`mapAudioEvent` maps the host event kinds as follows:

| Event | Cue | Surface |
|---|---|---|
| `mining` | `blockBreak` | Resolved by `surfaceForBlockType` |
| `place` | `blockPlace` | Resolved by `surfaceForBlockType` |
| `pickup` | `itemPickup` | None |
| `attack` | `entityHit` | None |
| `hurt` targeting the player | `playerHurt` | None |
| `hurt` targeting a mob | `mobHurt` | None |
| `mobDeath` | `mobDeath` | None |
| `footstep` | Default: `footstepDefault`; grass: `footstepGrass`; stone: `footstepStone`; wood: `footstepWood` | Resolved by `surfaceForBlockType` |
| `ambient` with `layer: 'thunder'` | `thunderClap` | None |
| `ambient` with `layer: 'rain'` or no layer | `rainAmbient` | None |
| `enchant` | `enchant` | None |
| `inventoryOpen` | `inventoryOpen` | None |
| `inventoryClose` | `inventoryClose` | None |
| `levelUp` | `levelUp` | None |
| `achievementUnlock` | `achievementUnlock` | None |

`mapAudioEvent` returns a cue for every listed event. The `SoundCueService` emits captions before calling `AudioBackend.playTone`, including when an asset fails. Mining, placement, and footstep mappings return the resolved surface.

The WebAudio adapter infers the surface from default, grass, stone, and wood footstep cues. It prefers exact-surface variants, then variants without a surface, and otherwise considers all variants. It cycles through eligible variants in manifest order. Hosts that need surface selection for mining or placement can call `selectAudioAsset({ manifest, cueId, variantIndex: AudioCount(0), surface })`; `AudioCount` brands the zero-based variant index as a non-negative integer. The helper returns a typed failure if that cue has no variants.

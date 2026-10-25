# Migrating to mc-audio 0.4

mc-audio 0.4 updates the package to Effect 4 and mc-kernel 0.9. It also moves
caption queue, audio runtime, footstep mapping, and audio QA ownership into this
package.

## Dependencies

Use the package's exact dependency set when reproducing its build: `effect`
4.0.5, `@effect/vitest` 4.0.5, Vitest and its coverage and browser integrations
5.0.5, TypeScript 7.0.2, and mc-kernel 0.9.0. The package keeps its Node.js
minimum at 24; CI runs on Node.js 26.

## Branded audio values

Audio quantities and identifiers now use branded types. Import their constructors
from the package root alongside the corresponding types. For example:

```ts
import { AudioGain, AudioVolume } from '@nerima-games/mc-audio'

const gain = AudioGain.result(rawGain)
const volume = AudioVolume.option(rawVolume)
```

Use `.result` or `.option` for values from untrusted input. The direct
constructor is for values already known to satisfy the brand's constraints.
This applies to audio gain, volume, pan, frequency, duration, playback rate,
distance, ticks, sample IDs and URLs, handles, and Minecraft sound identifiers.

## mc-kernel imports and results

Import kernel values from their public domain entrypoints:

| Value | Import path |
| --- | --- |
| `CameraPoseSnapshot` | `@nerima-games/mc-kernel/domain/camera` |
| `ClockPort` | `@nerima-games/mc-kernel/domain/clock` |
| `Position`, `PositionAxis` | `@nerima-games/mc-kernel/domain/coordinates` |
| `MonotonicTimeSecs` | `@nerima-games/mc-kernel/domain/quantities` |
| `AngleRadians` | `@nerima-games/mc-kernel/domain/shared-vocabulary` |
| `BlockId`, block registry validators | `@nerima-games/mc-kernel/domain/block-registry` |

`Position` axes, camera angles, and monotonic times are branded values. Use the
brand constructor's `.result` or `.option` when converting untrusted numbers.
Kernel block registry queries return `Result` values in 0.9; handle their
failure branch before using the success value.

Minecraft sound parsing, resolution, and playback planning also return `Result`
values. Sound registries and `AudioSampleManifest` use read-only maps keyed by
branded identifiers; use `.get` and check for `undefined` instead of indexing an
object by string.

## Effect 4

Services now use `Context.Service`. Replace Effect 3 `Effect.catchAll` handlers
with `Effect.catch`; use `Effect.catchCause` only when the handler must account
for defects or interruption as well as typed failures. WebAudio promises stay
behind the adapter and become Effects with an explicit failure mapping.

`makeAudioRuntime` still returns an Effect. Its `play`, `unlock`, `visible`,
`snapshot`, `configure`, and `close` operations now return Effects too. Run
those Effects at the host boundary. The audio QA provider exposes Effect
commands, while `makeAudioQaEntrypoint` adapts the report and snapshot commands
to the synchronous QA API at an allowed package entrypoint.

## Public API signature changes

This inventory compares the public call signatures in the generated declarations
for base commit `1d87499e082f146cba3292703bb115f3e38331e6` and API head
`227d46eb0b236f49067dbed3e656cb2f81c80c9b`. No existing public exports were
removed. `SoundCueId` was already exported as a type and now also exports a
constructor. At each revision, `nix develop --command corepack pnpm build`
emitted declarations with that revision's release TypeScript config. A
TypeScript 5.9.3 compiler-API walk follows the package-root re-exports and
compares call and construct signatures. It normalizes workspace-specific paths
and maps Effect and mc-kernel declaration paths to their public entrypoints
before classifying a difference as a signature change.

The following exports now return `Result`; callers must handle the failure
branch before using the success value:

| Export | Return type |
| --- | --- |
| `canPlayMinecraftFireflyBushIdleSounds` | `Result<boolean, MinecraftFireflyBushSoundFailure>` |
| `createFreeMinecraftMusicManifest` | `Result<AudioSampleManifest, FreeMusicBankFailure \| AudioSampleManifestFailure>` |
| `createFreeMinecraftMusicPack` | `Result<FreeMinecraftMusicPack, FreeMusicBankFailure \| AudioSampleManifestFailure>` |
| `createMinecraft26_2SoundRegistry` | `Result<MinecraftSoundRegistry, MinecraftSoundsParseFailure>` |
| `createMinecraft26_3Snapshot9SoundRegistry` | `Result<MinecraftSoundRegistry, MinecraftSoundsParseFailure>` |
| `generateFreeMusicWav` | `Result<ArrayBuffer, FreeMusicBankFailure>` |
| `minecraftSoundManifest` | `Result<AudioSampleManifest, MinecraftSoundResolutionFailure>` |
| `normalizeMinecraftAmbientSoundsDefinition` | `Result<NormalizedMinecraftAmbientSoundsDefinition, MinecraftAmbientSoundsFailure>` |
| `normalizeMinecraftAudioComponent` | `Result<NormalizedMinecraftAudioComponent, MinecraftAudioFailure>` |
| `normalizeMinecraftBiomeMusic` | `Result<readonly NormalizedMinecraftBiomeMusicDefinition[], MinecraftMusicDataFailure>` |
| `normalizeMinecraftBiomeMusicDefinition` | `Result<NormalizedMinecraftBiomeMusicDefinition, MinecraftMusicDataFailure>` |
| `normalizeMinecraftMusicDefinition` | `Result<NormalizedMinecraftMusicDefinition, MinecraftMusicDataFailure>` |
| `normalizeMinecraftSoundId` | `Result<MinecraftSoundResourceId, MinecraftSoundsParseFailure>` |
| `parseMinecraftAudioComponent` | `Result<NormalizedMinecraftAudioComponent, MinecraftAudioFailure>` |
| `parseMinecraftMobSoundVariantJson` | `Result<MinecraftMobSoundVariantDefinition, MinecraftMobSoundVariantParseFailure>` |
| `parseMinecraftMobSoundVariantRegistry` | `Result<MinecraftMobSoundVariantRegistry, MinecraftMobSoundVariantParseFailure>` |
| `parseMinecraftSoundsJson` | `Result<MinecraftSoundRegistry, MinecraftSoundsParseFailure>` |
| `parseMinecraftWolfSoundDefinition` | `Result<MinecraftWolfSoundDefinition, MinecraftMobSoundVariantParseFailure>` |
| `planMinecraftAmbientSounds` | `Result<MinecraftAmbientSoundsPlan, MinecraftAmbientSoundsFailure \| MinecraftAmbientSoundsPlannerFailure>` |
| `planMinecraftMusic` | `Result<MinecraftMusicPlan, MinecraftMusicDataFailure>` |
| `planMinecraftSound` | `Result<MinecraftSoundPlaybackPlan, MinecraftSoundResolutionFailure \| MinecraftSoundPlayOptionsFailure>` |
| `resolveMinecraftMobSound` | `Result<ResolvedMinecraftSound, MinecraftSoundResolutionFailure \| MinecraftMobSoundVariantResolutionFailure>` |
| `resolveMinecraftMobSoundEventId` | `Result<MinecraftSoundEventId, MinecraftMobSoundVariantResolutionFailure>` |
| `resolveMinecraftMobSoundVariant` | `Result<ResolvedMinecraftSound, MinecraftSoundResolutionFailure \| MinecraftMobSoundVariantResolutionFailure>` |
| `resolveMinecraftSound` | `Result<ResolvedMinecraftSound, MinecraftSoundResolutionFailure>` |
| `resolveMinecraftWolfSound` | `Result<ResolvedMinecraftSound, MinecraftSoundResolutionFailure \| MinecraftMobSoundVariantResolutionFailure>` |
| `resolveMinecraftWolfSoundEventId` | `Result<MinecraftSoundEventId, MinecraftMobSoundVariantResolutionFailure>` |
| `selectMinecraftBiomeMusicDefinition` | `Result<NormalizedMinecraftMusicDefinition \| null, MinecraftMusicDataFailure>` |
| `selectMinecraftSoundVariant` | `Result<MinecraftSoundVariant, MinecraftSoundResolutionFailure>` |

These additional signatures use branded audio or Minecraft values, or accept
`unknown` at a validation boundary. `generateFreeMinecraftWav`,
`minecraftSoundManifest`, `normalizeMinecraftSoundId`, `planMinecraftSound`,
`resolveMinecraftMobSoundVariant`, `resolveMinecraftSound`,
`selectMinecraftBiomeMusicDefinition`, and `selectMinecraftSoundVariant` also
appear above because they now return `Result`.

| Export | Signature change |
| --- | --- |
| `clamp01` | `(number) => number` to `(unknown) => AudioVolume` |
| `clampNonNegative` | `(number) => number` to `(unknown) => AudioGain` |
| `clampPan` | `(number) => number` to `(unknown) => AudioPan` |
| `drivenFrequency` | `(number) => number` to `(AudioFrequencyHz) => AudioFrequencyHz` |
| `effectiveMusicGain` | Numeric `baseGain` and `musicVolume` inputs and numeric result to `AudioGain`, `AudioVolume`, and `AudioGain` respectively |
| `effectiveSfxGain` | Numeric gain and volume inputs and numeric result to `AudioGain`/`AudioVolume` inputs and an `AudioGain` result |
| `gainAt` | Numeric `atSecs` and result to `AudioDurationSecs` and `AudioGain` |
| `isSoundCueId` | `value: string` to `value: unknown` |
| `makeMinecraftAmbientSoundsPlayer` | `randomSource: () => number` to `randomSource: () => unknown` |
| `makeMinecraftMusicPlayer` | `randomSource: () => number` to `randomSource: () => unknown` |
| `makeMinecraftSoundPlayer` | `randomSource: () => number` to `randomSource: () => unknown` |
| `masterNodeGain` | Numeric result to `AudioVolume` |
| `minecraftSoundAssetUrl` | String sound ID and base URL inputs and string result to `MinecraftSoundResourceId`/`AudioSampleUrl` inputs and an `AudioSampleUrl` result |
| `musicTrackGain` | Numeric `musicVolume` and result to `AudioVolume` and `AudioGain` |
| `toneEnvelope` | Numeric `startSecs` to `AudioDurationSecs` |

The declaration diff also changes dependency type import paths without changing
these function argument or return types: `firstCaptionFor`,
`makeRecordingBackend`, `makeSoundCueService`, `makeWebAudioBackend`,
`minecraftSpatialise`, `recordingCaptionLayer`, `resolveMusicPlan`, `spatialise`,
`visibleCaptions`, and `webAudioBackendLayer`. These use the Effect 4 declarations
or the mc-kernel 0.9 public entrypoints listed above.

## Ownership additions

The caption API adds `CaptionQueue`, `CaptionSettings`, `emptyCaptionQueue`,
`receiveCaption`, `applyCaptionSettings`, and `expireCaptions`. The display
lifetime remains 2.5 seconds and the visible limit remains five entries.
`CAPTION_LIFETIME_SECS` is the canonical constant; `CAPTION_DISPLAY_SECS`
remains as a compatibility alias. The existing `visibleCaptions` API remains
available.

Footstep audio owns `FootstepSurface`, `cueForSurface`, and
`surfaceForBlockType`. `footstepCueFor` remains as a compatibility alias. The
runtime cadence and distance state belong to mx-gameplay.

Weather inputs now use `clear`, `rain`, and `thunder`, matching mc-sim's weather
vocabulary. Remove `snow` from callers before upgrading; mc-audio no longer
maps snow to a wind sound.

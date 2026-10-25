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

Use `.result` or `.option` for values from untrusted input. `.result(raw)`
returns a `Result`; `.option(raw)` returns an `Option`. Check `Result.isSuccess`
or `Option.isSome` before using the wrapped value. The direct constructor is for
values already known to satisfy the brand's constraints.
This applies to audio gain, volume, pan, frequency, duration, playback rate,
distance, ticks, sample IDs and URLs, handles, and Minecraft sound identifiers.

Use the constructor matching the target type. `.result(raw)` returns a `Result`
and makes invalid input explicit; do not cast a raw value or substitute a
different brand. The constructors for nominal text brands accept any string.

| Branded type | Constructor for raw input |
| --- | --- |
| `AudioBpm` | `AudioBpm.result(number)` |
| `AudioCaptionText` | `AudioCaptionText(string)` |
| `AudioCount` | `AudioCount.result(number)` |
| `AudioDelayTicks` | `AudioDelayTicks.result(number)` |
| `AudioDiagnosticMessage` | `AudioDiagnosticMessage(string)` |
| `AudioDiagnosticPath` | `AudioDiagnosticPath(string)` |
| `AudioDistance` | `AudioDistance.result(number)` |
| `AudioDurationSecs` | `AudioDurationSecs.result(number)` |
| `AudioEventId` | `AudioEventId.result(string)` |
| `AudioFrequencyHz` | `AudioFrequencyHz.result(number)` |
| `AudioGain` | `AudioGain.result(number)` |
| `AudioHandleId` | `AudioHandleId.result(number)` |
| `AudioNote` | `AudioNote.result(number)` |
| `AudioOffset` | `AudioOffset.result(number)` |
| `AudioPan` | `AudioPan.result(number)` |
| `AudioPlaybackRate` | `AudioPlaybackRate.result(number)` |
| `AudioRuntimeCaptionSignature` | `AudioRuntimeCaptionSignature(string)` |
| `AudioSampleId` | `AudioSampleId.result(string)` |
| `AudioSampleRate` | `AudioSampleRate.result(number)` |
| `AudioSampleUrl` | `AudioSampleUrl.result(string)` |
| `AudioSeed` | `AudioSeed.result(number)` |
| `AudioTick` | `AudioTick.result(number)` |
| `AudioVolume` | `AudioVolume.result(number)` |
| `AudioWeight` | `AudioWeight.result(number)` |
| `MinecraftMobSoundVariantId` | `MinecraftMobSoundVariantId.result(string)` |
| `MinecraftSoundEventId` | `MinecraftSoundEventId.result(string)` |
| `MinecraftSoundNamespace` | `MinecraftSoundNamespace.result(string)` |
| `MinecraftSoundResourceId` | `MinecraftSoundResourceId.result(string)` |
| `SoundCueId` | `SoundCueId.result(string)` |
| `PositionAxis` | `PositionAxis.result(number)` from `@nerima-games/mc-kernel/domain/coordinates` |
| `MonotonicTimeSecs` | `MonotonicTimeSecs.result(number)` from `@nerima-games/mc-kernel/domain/quantities` |

For free music, `soundId` uses `MinecraftSoundResourceId.result(rawSoundId)`,
while event IDs, including the `FreeMusicEventId` alias, use
`MinecraftSoundEventId.result(rawEventId)`. `AudioSampleManifest` is now a
`ReadonlyMap<AudioSampleId, AudioSampleSource>`; build or read it as a map and
check `.get(id)` for `undefined`.

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

## Public API declaration changes

This inventory compares the generated package-root declaration graphs for base
commit `1d87499e082f146cba3292703bb115f3e38331e6` and merged API commit
`c98a638c5022161bd8b1daa438742eb098ef5b5a`. The package-root graph has 67 added
exports and no removed exports. The callable-signature inventory found 47 existing
exports with changed argument or return types.

The exported type-member table is generated by `scripts/compare-public-api.mjs`.
It follows root re-exports, expands discriminated union variants, and compares
exported constant array element shapes. Regenerate it by building both package
roots to `dist`, then running `node scripts/compare-public-api.mjs <base-package-root> <head-package-root> markdown`. The type aliases and member changes are listed below. `SoundCueId` was already exported as a type and now also exports a constructor. `OriginalSampleBankFailure` is a new exported error type for the original sample generator.

The following 32 exports now return `Result`; callers must handle the failure
branch before using the success value:

| Export | Return type |
| --- | --- |
| `canPlayMinecraftFireflyBushIdleSounds` | `Result<boolean, MinecraftFireflyBushSoundFailure>` |
| `createFreeMinecraftMusicManifest` | `Result<AudioSampleManifest, FreeMusicBankFailure \| AudioSampleManifestFailure>` |
| `createFreeMinecraftMusicPack` | `Result<FreeMinecraftMusicPack, FreeMusicBankFailure \| AudioSampleManifestFailure>` |
| `createMinecraft26_2SoundRegistry` | `Result<MinecraftSoundRegistry, MinecraftSoundsParseFailure>` |
| `createMinecraft26_3Snapshot9SoundRegistry` | `Result<MinecraftSoundRegistry, MinecraftSoundsParseFailure>` |
| `createOriginalSampleManifest` | `Result<AudioSampleManifest, OriginalSampleBankFailure>` |
| `generateFreeMusicWav` | `Result<ArrayBuffer, FreeMusicBankFailure>` |
| `generateOriginalSampleWav` | `Result<ArrayBuffer, OriginalSampleBankFailure>` |
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
| `planEndAudio` | `Result<EndAudioPlan, EndAudioClockFailure \\| EndAudioSoundLimitFailure>` |
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

These Result-returning exports also changed argument types:

| Export | Argument change |
| --- | --- |
| `generateFreeMusicWav` | `soundId: string` to `soundId: FreeMusicTrack['soundId']` (`MinecraftSoundResourceId`) |
| `minecraftSoundManifest` | `baseUrl: string` to `baseUrl: AudioSampleUrl` |
| `normalizeMinecraftSoundId` | `defaultNamespace: string` to `MinecraftSoundNamespace`; `path: string` to `unknown` |
| `planMinecraftSound` | `eventId: string` to `MinecraftSoundEventId` |
| `resolveMinecraftMobSoundVariant` | `variantId: string` to `MinecraftMobSoundVariantId` |
| `resolveMinecraftSound` | `eventId: string` to `MinecraftSoundEventId`; `random?: number` to `unknown` |
| `selectMinecraftBiomeMusicDefinition` | `random: number` to `unknown` |
| `selectMinecraftSoundVariant` | `random?: number` to `unknown` |

`generateFreeMusicWav` therefore needs the brand for the `FreeMusicTrack` sound
resource, not the similarly named event ID or cue ID.

`OriginalSampleBankFailure.field` identifies invalid `options`, `soundId`,
`sampleRate`, or `seed` input. Its `message` is `AudioDiagnosticMessage`, a
nominal string brand constructed with `AudioDiagnosticMessage(message)`. The
generated WAV or manifest is available only from the `Result` success branch.

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

## Exported type member changes

The package-root declaration comparison found 271 changed members across 101 existing exported object and union types. The inventory follows re-export aliases and expands each discriminated union branch. No member was added or changed between optional and required; six former members are absent because `MinecraftBackgroundMusicInputEntry` and `MinecraftBiomeMusicDefinition` now accept `unknown`. The nine WebAudio `start`, `stop`, `cancelScheduledValues`, `linearRampToValueAtTime`, and `setValueAtTime` members are methods in 0.4 where they were readonly function properties. Other members retain their original mutability. A `?` marks an optional member.

| Exported type member | Base declaration | Head declaration |
| --- | --- | --- |
| `AudioBackend.setMasterGain` | `(gain: number) => Effect.Effect<void>` | `(gain: AudioVolume) => Effect.Effect<void>` |
| `AudioBackend.setToneGain` | `(handle: ToneHandle, gain: number) => Effect.Effect<void>` | `(handle: ToneHandle, gain: AudioGain) => Effect.Effect<void>` |
| `AudioBufferSourceSurface.start` | `(when?: number) => void` | `(when?: unknown) => void` (method) |
| `AudioBufferSourceSurface.stop` | `(when?: number) => void` | `(when?: unknown) => void` (method) |
| `AudioBufferSurface.duration` | `number` | `unknown` |
| `AudioContextSurface.close` | `() => Promise<void>` | `() => PromiseLike<void>` |
| `AudioContextSurface.currentTime` | `number` | `unknown` |
| `AudioContextSurface.decodeAudioData` | `(audioData: ArrayBuffer) => Promise<AudioBufferSurface>` | `(audioData: ArrayBuffer) => PromiseLike<AudioBufferSurface>` |
| `AudioContextSurface.resume` | `() => Promise<void>` | `() => PromiseLike<void>` |
| `AudioParamSurface.cancelScheduledValues` | `(cancelTime: number) => AudioParamSurface` | `(cancelTime: unknown) => AudioParamSurface` (method) |
| `AudioParamSurface.linearRampToValueAtTime` | `(value: number, endTime: number) => AudioParamSurface` | `(value: unknown, endTime: unknown) => AudioParamSurface` (method) |
| `AudioParamSurface.setValueAtTime` | `(value: number, startTime: number) => AudioParamSurface` | `(value: unknown, startTime: unknown) => AudioParamSurface` (method) |
| `AudioParamSurface.value` | `number` | `unknown` |
| `AudioSampleLoadReport.cached` | `number` | `AudioCount` |
| `AudioSampleLoadReport.failed` | `number` | `AudioCount` |
| `AudioSampleLoadReport.loaded` | `number` | `AudioCount` |
| `AudioSampleLoadReport.requested` | `number` | `AudioCount` |
| `AudioSampleSource[kind=url].url` | `string` | `AudioSampleUrl` |
| `AudioScheduledSourceSurface.start` | `(when?: number) => void` | `(when?: unknown) => void` (method) |
| `AudioScheduledSourceSurface.stop` | `(when?: number) => void` | `(when?: unknown) => void` (method) |
| `CaptionEvent.cueId` | `string` | `SoundCueId \| MinecraftSoundEventId` |
| `CaptionEvent.pan` | `number?` | `AudioPan?` |
| `CaptionEvent.text` | `string` | `AudioCaptionText` |
| `CueDefinition.baseGain` | `number` | `AudioGain` |
| `CueDefinition.caption` | `string \| null` | `AudioCaptionText \| null` |
| `CueDefinition.durationSecs` | `number` | `AudioDurationSecs` |
| `CueDefinition.frequency` | `number` | `AudioFrequencyHz` |
| `CuePlayOptions.gainScale` | `number?` | `AudioGain?` |
| `EndAudioController.update` | `(snapshot: EndAudioSnapshot) => void` | `(snapshot: EndAudioSnapshot) => Result.Result<void, EndAudioClockFailure \| EndAudioSoundLimitFailure>` |
| `EndAudioEvent.id` | `string` | `AudioEventId` |
| `EndAudioEventPlan.eventId` | `string` | `AudioEventId` |
| `EndAudioEventPlan.gain` | `number` | `AudioGain` |
| `EndAudioEventPlan.pan` | `number` | `AudioPan` |
| `EndAudioFallbackPlan.durationSecs` | `number` | `AudioDurationSecs` |
| `EndAudioFallbackPlan.frequency` | `number` | `AudioFrequencyHz` |
| `EndAudioFallbackPlan.gain` | `number` | `AudioGain` |
| `EndAudioFallbackPlan.pan` | `number` | `AudioPan` |
| `EndAudioHandle.id` | `number` | `AudioHandleId` |
| `EndAudioLoopPlan.fadeSecs` | `number` | `AudioDurationSecs` |
| `EndAudioLoopPlan.gain` | `number` | `AudioGain` |
| `EndAudioPort.createLoop` | `(kind: EndAudioLoopKind, initialGain: number) => EndAudioHandle \| null` | `(kind: EndAudioLoopKind, initialGain: AudioGain) => EndAudioHandle \| null` |
| `EndAudioPort.setLoopGain` | `(handle: EndAudioHandle, gain: number, fadeSecs: number) => void` | `(handle: EndAudioHandle, gain: AudioGain, fadeSecs: AudioDurationSecs) => void` |
| `EndAudioPort.stopLoop` | `(handle: EndAudioHandle, fadeSecs: number) => void` | `(handle: EndAudioHandle, fadeSecs: AudioDurationSecs) => void` |
| `EndAudioSnapshot.maxSimultaneousSounds` | `number?` | `AudioCount?` |
| `EndAudioSnapshot.nowSecs` | `number` | `MonotonicTimeSecs` |
| `EndAudioState.activeUntilSecs` | `readonly number[]` | `readonly MonotonicTimeSecs[]` |
| `EndAudioState.lastPlayedAtSecs` | `Readonly<Partial<Record<"dragonDeath" \| "dragonFlap" \| "dragonHurt" \| "dragonReward" \| "dragonRoar" \| "exitPortal" \| "eyeThrow" \| "frameInsert" \| "playerHit" \| "portalActivate", number>>>` | `Readonly<Partial<Record<"dragonDeath" \| "dragonFlap" \| "dragonHurt" \| "dragonReward" \| "dragonRoar" \| "exitPortal" \| "eyeThrow" \| "frameInsert" \| "playerHit" \| "portalActivate", MonotonicTimeSecs>>>` |
| `EndAudioState.recentEventIds` | `readonly string[]` | `readonly AudioEventId[]` |
| `EnvelopePoint.atSecs` | `number` | `AudioDurationSecs` |
| `EnvelopePoint.gain` | `number` | `AudioGain` |
| `FreeMinecraftMusicPack.manifest` | `Readonly<Record<string, import("./audio-sample.js").AudioSampleSource>>` | `AudioSampleManifest` |
| `FreeMusicBankOptions.durationSecs` | `number?` | `AudioDurationSecs?` |
| `FreeMusicBankOptions.sampleRate` | `number?` | `AudioSampleRate?` |
| `FreeMusicEventVariant[type=sound].soundId` | `string` | `MinecraftSoundResourceId` |
| `FreeMusicEventVariant[type=sound].type` | `"event" \| "sound"` | `"sound"` |
| `FreeMusicEventVariant[type=sound].volume` | `number` | `AudioGain` |
| `FreeMusicEventVariant[type=sound].weight` | `number` | `AudioWeight` |
| `FreeMusicEventVariant[type=event].soundId` | `string` | `MinecraftSoundEventId` |
| `FreeMusicEventVariant[type=event].type` | `"event" \| "sound"` | `"event"` |
| `FreeMusicEventVariant[type=event].volume` | `number` | `AudioGain` |
| `FreeMusicEventVariant[type=event].weight` | `number` | `AudioWeight` |
| `FreeMusicTrack.bpm` | `number` | `AudioBpm` |
| `FreeMusicTrack.eventId` | `string` | `MinecraftSoundEventId` |
| `FreeMusicTrack.notes` | `readonly [number, ...number[]]` | `readonly AudioNote[]` |
| `FreeMusicTrack.soundId` | `string` | `MinecraftSoundResourceId` |
| `FreeMusicTrack.volume` | `number` | `AudioGain` |
| `FreeMusicTrack.weight` | `number` | `AudioWeight` |
| `GameAudioEvent.cueId` | `"achievementUnlock" \| "blockBreak" \| "blockPlace" \| "enchant" \| "entityHit" \| "footstepGrass" \| "footstepStone" \| "footstepWood" \| "inventoryClose" \| "inventoryOpen" \| "itemPickup" \| "levelUp" \| "mobDeath" \| "mobHurt" \| "playerHurt" \| "rainAmbient" \| "thunderClap"` | `SoundCueId` |
| `GameAudioEvent.gainScale` | `number?` | `AudioGain?` |
| `Minecraft26_2SoundDefinition.subtitle` | `string?` | `unknown?` |
| `Minecraft26_2SoundVariantDefinition[variant-2].attenuation_distance` | `number?` | `unknown?` |
| `Minecraft26_2SoundVariantDefinition[variant-2].name` | `string` | `unknown` |
| `Minecraft26_2SoundVariantDefinition[variant-2].pitch` | `number?` | `unknown?` |
| `Minecraft26_2SoundVariantDefinition[variant-2].volume` | `number?` | `unknown?` |
| `Minecraft26_2SoundVariantDefinition[variant-2].weight` | `number?` | `unknown?` |
| `Minecraft26_3Snapshot9SoundDefinition.subtitle` | `string?` | `unknown?` |
| `Minecraft26_3Snapshot9SoundVariantDefinition[variant-2].attenuation_distance` | `number?` | `unknown?` |
| `Minecraft26_3Snapshot9SoundVariantDefinition[variant-2].name` | `string` | `unknown` |
| `Minecraft26_3Snapshot9SoundVariantDefinition[variant-2].pitch` | `number?` | `unknown?` |
| `Minecraft26_3Snapshot9SoundVariantDefinition[variant-2].volume` | `number?` | `unknown?` |
| `Minecraft26_3Snapshot9SoundVariantDefinition[variant-2].weight` | `number?` | `unknown?` |
| `MinecraftAmbientAddition.sound` | `string` | `MinecraftSoundEventId` |
| `MinecraftAmbientAddition.tick_chance` | `number` | `AudioVolume` |
| `MinecraftAmbientMood.block_search_extent` | `number` | `AudioCount` |
| `MinecraftAmbientMood.offset` | `number` | `AudioOffset` |
| `MinecraftAmbientMood.sound` | `string` | `MinecraftSoundEventId` |
| `MinecraftAmbientMood.tick_delay` | `number` | `AudioDelayTicks` |
| `MinecraftAmbientMoodResolution.delayTicks` | `number` | `AudioDelayTicks` |
| `MinecraftAmbientMoodResolverInput.randomSource` | `() => number` | `() => unknown` |
| `MinecraftAmbientMoodResolverInput.tick` | `number` | `AudioTick` |
| `MinecraftAmbientSoundsCommand[kind=start-loop].sound` | `string` | `MinecraftSoundEventId` |
| `MinecraftAmbientSoundsCommand[kind=play,category=mood].offset` | `number` | `AudioOffset` |
| `MinecraftAmbientSoundsCommand[kind=play,category=mood].sound` | `string` | `MinecraftSoundEventId` |
| `MinecraftAmbientSoundsCommand[kind=play,category=addition].sound` | `string` | `MinecraftSoundEventId` |
| `MinecraftAmbientSoundsDefinition.additions` | `readonly MinecraftAmbientAddition[]?` | `unknown?` |
| `MinecraftAmbientSoundsDefinition.loop` | `string?` | `unknown?` |
| `MinecraftAmbientSoundsDefinition.mood` | `MinecraftAmbientMood?` | `unknown?` |
| `MinecraftAmbientSoundsPlannerInput.randomSource` | `() => number` | `() => unknown` |
| `MinecraftAmbientSoundsPlannerInput.tick` | `number` | `AudioTick` |
| `MinecraftAmbientSoundsPlayback.playedSoundIds` | `readonly string[]` | `readonly MinecraftSoundResourceId[]` |
| `MinecraftAmbientSoundsPlaybackError.soundId` | `string` | `MinecraftSoundEventId \| null` |
| `MinecraftAmbientSoundsState.loopSound` | `string \| null` | `MinecraftSoundEventId \| null` |
| `MinecraftAmbientSoundsState.nextMoodTick` | `number` | `AudioTick` |
| `MinecraftAmbientSoundsTickOptions.ambientVolume` | `number?` | `AudioVolume?` |
| `MinecraftAmbientSoundsTickOptions.tick` | `number` | `AudioTick` |
| `MinecraftAudioComponent.minecraft:audio/background_music` | `Readonly<Partial<Record<import("./minecraft-music-data.js").MinecraftBackgroundMusicKey, import("./minecraft-music-data.js").MinecraftBackgroundMusicInputEntry>>>?` | `Readonly<Partial<Record<import("./minecraft-music-data.js").MinecraftBackgroundMusicKey, unknown>>>?` |
| `MinecraftAudioComponent.minecraft:audio/music_volume` | `number?` | `unknown?` |
| `MinecraftBackgroundMusicEntry[variant-1].max_delay` | `number` | `AudioDelayTicks` |
| `MinecraftBackgroundMusicEntry[variant-1].min_delay` | `number` | `AudioDelayTicks` |
| `MinecraftBackgroundMusicEntry[variant-1].sound` | `string` | `MinecraftSoundEventId` |
| `MinecraftBackgroundMusicInputEntry[variant-1].max_delay` | `number` | `absent` |
| `MinecraftBackgroundMusicInputEntry[variant-1].min_delay` | `number` | `absent` |
| `MinecraftBackgroundMusicInputEntry[variant-1].replace_current_music` | `boolean?` | `absent` |
| `MinecraftBackgroundMusicInputEntry[variant-1].sound` | `string` | `absent` |
| `MinecraftBiomeMusicDefinition.data` | `MinecraftMusicDefinition` | `absent` |
| `MinecraftBiomeMusicDefinition.weight` | `number` | `absent` |
| `MinecraftCatSoundSet.ambientSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftCatSoundSet.begForFoodSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftCatSoundSet.deathSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftCatSoundSet.eatSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftCatSoundSet.hissSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftCatSoundSet.hurtSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftCatSoundSet.purrSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftCatSoundSet.purreowSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftCatSoundSet.strayAmbientSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftChickenSoundSet.ambientSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftChickenSoundSet.deathSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftChickenSoundSet.hurtSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftChickenSoundSet.stepSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftCowSoundSet.ambientSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftCowSoundSet.deathSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftCowSoundSet.hurtSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftCowSoundSet.stepSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftMobSoundResolutionOptions.random` | `number?` | `unknown?` |
| `MinecraftMobSoundVariantDefinition[kind=cat].id` | `string` | `MinecraftMobSoundVariantId` |
| `MinecraftMobSoundVariantDefinition[kind=pig].id` | `string` | `MinecraftMobSoundVariantId` |
| `MinecraftMobSoundVariantDefinition[kind=cow].id` | `string` | `MinecraftMobSoundVariantId` |
| `MinecraftMobSoundVariantDefinition[kind=chicken].id` | `string` | `MinecraftMobSoundVariantId` |
| `MinecraftMobSoundVariantJsonOptions.namespace` | `string` | `MinecraftSoundNamespace` |
| `MinecraftMobSoundVariantJsonOptions.variantId` | `string` | `MinecraftMobSoundVariantId` |
| `MinecraftMobSoundVariantRegistry.variants` | `Readonly<Record<string, MinecraftMobSoundVariantDefinition>>` | `ReadonlyMap<MinecraftMobSoundVariantId, MinecraftMobSoundVariantDefinition>` |
| `MinecraftMobSoundVariantRegistryOptions.namespace` | `string` | `MinecraftSoundNamespace` |
| `MinecraftMobSoundVariantRegistryParseOptions.namespace` | `string` | `MinecraftSoundNamespace` |
| `MinecraftMusicCommand[kind=start].gain` | `number` | `AudioVolume` |
| `MinecraftMusicCommand[kind=gain].gain` | `number` | `AudioVolume` |
| `MinecraftMusicDefinition.max_delay` | `number` | `AudioDelayTicks` |
| `MinecraftMusicDefinition.min_delay` | `number` | `AudioDelayTicks` |
| `MinecraftMusicDefinition.sound` | `string` | `MinecraftSoundEventId` |
| `MinecraftMusicPlannerInput.musicVolume` | `number` | `AudioVolume` |
| `MinecraftMusicPlannerInput.randomIntInclusive` | `(min: number, max: number) => number` | `(min: AudioDelayTicks, max: AudioDelayTicks) => unknown` |
| `MinecraftMusicPlaybackError.soundId` | `string` | `MinecraftSoundEventId \| MinecraftSoundResourceId \| null` |
| `MinecraftMusicState.currentGain` | `number` | `AudioVolume` |
| `MinecraftMusicState.currentSound` | `string \| null` | `MinecraftSoundEventId \| null` |
| `MinecraftMusicState.nextSongDelayTicks` | `number` | `AudioTick` |
| `MinecraftMusicTickInput.musicVolume` | `number?` | `AudioVolume?` |
| `MinecraftMusicTickResult.soundId` | `string \| null` | `MinecraftSoundEventId \| null` |
| `MinecraftPigSoundSet.ambientSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftPigSoundSet.deathSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftPigSoundSet.eatSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftPigSoundSet.hurtSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftPigSoundSet.stepSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftSoundEvent.id` | `string` | `MinecraftSoundEventId` |
| `MinecraftSoundEvent.subtitle` | `string \| null` | `AudioCaptionText \| null` |
| `MinecraftSoundPlayOptions.durationSecs` | `number?` | `AudioDurationSecs?` |
| `MinecraftSoundPlayOptions.frequency` | `number?` | `AudioFrequencyHz?` |
| `MinecraftSoundPlayOptions.gainScale` | `number?` | `AudioGain?` |
| `MinecraftSoundPlayOptions.random` | `number?` | `unknown?` |
| `MinecraftSoundPlayOptions.sfxVolume` | `number?` | `AudioVolume?` |
| `MinecraftSoundPlayback.eventId` | `string` | `MinecraftSoundEventId` |
| `MinecraftSoundPlayback.subtitle` | `string \| null` | `AudioCaptionText \| null` |
| `MinecraftSoundPlaybackError.eventId` | `string` | `MinecraftSoundEventId` |
| `MinecraftSoundPlaybackPlan.eventId` | `string` | `MinecraftSoundEventId` |
| `MinecraftSoundPlaybackPlan.subtitle` | `string \| null` | `AudioCaptionText \| null` |
| `MinecraftSoundPlayer.play` | `(eventId: string, options?: MinecraftSoundPlayOptions) => Effect.Effect<MinecraftSoundPlayback, MinecraftSoundPlaybackError>` | `(eventId: MinecraftSoundEventId, options?: MinecraftSoundPlayOptions) => Effect.Effect<MinecraftSoundPlayback, MinecraftSoundPlaybackError>` |
| `MinecraftSoundRegistry.events` | `Readonly<Record<string, MinecraftSoundEvent>>` | `ReadonlyMap<MinecraftSoundEventId, MinecraftSoundEvent>` |
| `MinecraftSoundRegistryOptions.namespace` | `string` | `MinecraftSoundNamespace` |
| `MinecraftSoundVariant[type=sound].attenuationDistance` | `number` | `AudioDistance` |
| `MinecraftSoundVariant[type=sound].name` | `string` | `MinecraftSoundResourceId` |
| `MinecraftSoundVariant[type=sound].pitch` | `number` | `AudioPlaybackRate` |
| `MinecraftSoundVariant[type=sound].type` | `MinecraftSoundReferenceType` | `"sound"` |
| `MinecraftSoundVariant[type=sound].volume` | `number` | `AudioGain` |
| `MinecraftSoundVariant[type=sound].weight` | `number` | `AudioWeight` |
| `MinecraftSoundVariant[type=event].attenuationDistance` | `number` | `AudioDistance` |
| `MinecraftSoundVariant[type=event].name` | `string` | `MinecraftSoundEventId` |
| `MinecraftSoundVariant[type=event].pitch` | `number` | `AudioPlaybackRate` |
| `MinecraftSoundVariant[type=event].type` | `MinecraftSoundReferenceType` | `"event"` |
| `MinecraftSoundVariant[type=event].volume` | `number` | `AudioGain` |
| `MinecraftSoundVariant[type=event].weight` | `number` | `AudioWeight` |
| `MinecraftWolfSoundParserOptions.namespace` | `string` | `MinecraftSoundNamespace` |
| `MinecraftWolfSoundSet.ambientSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftWolfSoundSet.deathSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftWolfSoundSet.growlSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftWolfSoundSet.hurtSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftWolfSoundSet.pantSound` | `string` | `MinecraftSoundEventId` |
| `MinecraftWolfSoundSet.whineSound` | `string` | `MinecraftSoundEventId` |
| `MusicEnvironmentContext.caveThresholdY` | `number?` | `PositionAxis?` |
| `MusicRequest.gain` | `number` | `AudioGain` |
| `MusicRequest.playbackRate` | `number` | `AudioPlaybackRate` |
| `MusicRequest.soundId` | `string` | `MinecraftSoundResourceId` |
| `MusicTrack.baseGain` | `number` | `AudioGain` |
| `MusicTrack.frequency` | `number` | `AudioFrequencyHz` |
| `NormalizedMinecraftAmbientSoundsDefinition.loop` | `string \| null` | `MinecraftSoundEventId \| null` |
| `NormalizedMinecraftAudioComponent.musicVolume` | `number \| null` | `AudioVolume \| null` |
| `NormalizedMinecraftBiomeMusicDefinition.max_delay` | `number` | `AudioDelayTicks` |
| `NormalizedMinecraftBiomeMusicDefinition.min_delay` | `number` | `AudioDelayTicks` |
| `NormalizedMinecraftBiomeMusicDefinition.sound` | `string` | `MinecraftSoundEventId` |
| `NormalizedMinecraftBiomeMusicDefinition.weight` | `number` | `AudioWeight` |
| `NormalizedMinecraftMusicDefinition.max_delay` | `number` | `AudioDelayTicks` |
| `NormalizedMinecraftMusicDefinition.min_delay` | `number` | `AudioDelayTicks` |
| `NormalizedMinecraftMusicDefinition.sound` | `string` | `MinecraftSoundEventId` |
| `OriginalSampleBankOptions.sampleRate` | `number?` | `AudioSampleRate?` |
| `OriginalSampleBankOptions.seed` | `number?` | `AudioSeed?` |
| `OscillatorSurface.start` | `(when?: number) => void` | `(when?: unknown) => void` (method) |
| `OscillatorSurface.stop` | `(when?: number) => void` | `(when?: unknown) => void` (method) |
| `RecordedBackend.masterGains` | `Effect.Effect<readonly number[], never, never>` | `Effect.Effect<readonly AudioVolume[], never, never>` |
| `RecordedBackend.toneGains` | `Effect.Effect<readonly { readonly handle: ToneHandle; readonly gain: number; }[], never, never>` | `Effect.Effect<readonly { readonly handle: ToneHandle; readonly gain: AudioGain; }[], never, never>` |
| `ResolvedMinecraftSound.attenuationDistance` | `number` | `AudioDistance` |
| `ResolvedMinecraftSound.eventId` | `string` | `MinecraftSoundEventId` |
| `ResolvedMinecraftSound.pitch` | `number` | `AudioPlaybackRate` |
| `ResolvedMinecraftSound.soundId` | `string` | `MinecraftSoundResourceId` |
| `ResolvedMinecraftSound.volume` | `number` | `AudioGain` |
| `Spatialisation.gain` | `number` | `AudioVolume` |
| `Spatialisation.pan` | `number` | `AudioPan` |
| `SpatialisationOptions.distanceOffset` | `number?` | `AudioOffset?` |
| `SpatialisationOptions.distanceScale` | `number?` | `AudioDistance?` |
| `ThunderEvent.id` | `string` | `AudioEventId` |
| `ThunderEvent.occurredAtSecs` | `number` | `MonotonicTimeSecs` |
| `ThunderPlan.delaySecs` | `number` | `AudioDurationSecs` |
| `ThunderPlan.eventId` | `string` | `AudioEventId` |
| `ThunderPlan.gain` | `number` | `AudioGain` |
| `ThunderPlan.pan` | `number` | `AudioPan` |
| `ToneEnvelope.peakGain` | `number` | `AudioGain` |
| `ToneEnvelope.startSecs` | `number` | `AudioDurationSecs` |
| `ToneEnvelope.stopAtSecs` | `number \| null` | `AudioDurationSecs \| null` |
| `ToneHandle.id` | `number` | `AudioHandleId` |
| `TonePlayback.id` | `number` | `AudioHandleId` |
| `ToneRequest.durationSecs` | `number` | `AudioDurationSecs` |
| `ToneRequest.frequency` | `number` | `AudioFrequencyHz` |
| `ToneRequest.gain` | `number` | `AudioGain` |
| `ToneRequest.pan` | `number` | `AudioPan` |
| `ToneRequest.playbackRate` | `number?` | `AudioPlaybackRate?` |
| `ToneRequest.soundId` | `string?` | `SoundCueId \| AudioSampleId \| MinecraftSoundResourceId?` |
| `WeatherAmbienceState.lastThunderEventId` | `string \| null` | `AudioEventId \| null` |
| `WeatherAmbienceState.mode` | `"clear" \| "rain" \| "snow" \| "thunder"` | `"clear" \| "rain" \| "thunder"` |
| `WeatherAudioHandle.id` | `number` | `AudioHandleId` |
| `WeatherAudioPort.createLoop` | `(kind: WeatherLoopKind, initialGain: number) => WeatherAudioHandle` | `(kind: WeatherLoopKind, initialGain: AudioGain) => WeatherAudioHandle` |
| `WeatherAudioPort.playThunder` | `(request: { readonly delaySecs: number; readonly gain: number; readonly pan: number; }) => WeatherAudioHandle` | `(request: { readonly delaySecs: AudioDurationSecs; readonly gain: AudioGain; readonly pan: AudioPan; }) => WeatherAudioHandle` |
| `WeatherAudioPort.setLoopGain` | `(handle: WeatherAudioHandle, gain: number, fadeSecs: number) => void` | `(handle: WeatherAudioHandle, gain: AudioGain, fadeSecs: AudioDurationSecs) => void` |
| `WeatherAudioPort.stopLoop` | `(handle: WeatherAudioHandle, fadeSecs: number) => void` | `(handle: WeatherAudioHandle, fadeSecs: AudioDurationSecs) => void` |
| `WeatherAudioSnapshot.intensity` | `number` | `AudioVolume` |
| `WeatherAudioSnapshot.mode` | `"clear" \| "rain" \| "snow" \| "thunder"` | `"clear" \| "rain" \| "thunder"` |
| `WeatherAudioSnapshot.occlusion` | `number` | `AudioVolume` |
| `WeatherLoopPlan.fadeSecs` | `number` | `AudioDurationSecs` |
| `WeatherLoopPlan.gain` | `number` | `AudioGain` |
| `WeatherLoopPlan.kind` | `WeatherLoopKind` | `"rain"` |
| `WebAudioBackend.preloadSamples` | `(soundIds?: ReadonlyArray<string>) => Effect.Effect<AudioSampleLoadReport>` | `(soundIds?: ReadonlyArray<AudioSampleId>) => Effect.Effect<AudioSampleLoadReport>` |
| `WebAudioBackend.setMasterGain` | `(gain: number) => Effect.Effect<void>` | `(gain: AudioVolume) => Effect.Effect<void>` |
| `WebAudioBackend.setToneGain` | `(handle: ToneHandle, gain: number) => Effect.Effect<void>` | `(handle: ToneHandle, gain: AudioGain) => Effect.Effect<void>` |
| `WebAudioOptions.initialMasterGain` | `number?` | `AudioVolume?` |
| `WebAudioOptions.loadSampleData` | `((url: string) => Promise<ArrayBuffer>)?` | `((url: AudioSampleUrl) => PromiseLike<ArrayBuffer>)?` |
| `WebAudioOptions.maxConcurrentTones` | `number?` | `AudioCount?` |
| `WebAudioOptions.preloadStream` | `((soundId: string, source: AudioSampleSource) => Effect.Effect<boolean, unknown>)?` | `((soundId: AudioSampleId, source: AudioSampleSource) => Effect.Effect<boolean, unknown>)?` |
| `WebAudioOptions.resolveAudioBuffer` | `((soundId: string) => AudioBufferSurface \| null)?` | `((soundId: NonNullable<ToneRequest['soundId']>) => AudioBufferSurface \| null)?` |
| `WebAudioOptions.sampleManifest` | `Readonly<Record<string, AudioSampleSource>>?` | `AudioSampleManifest?` |
| `WebAudioReport.activeTones` | `number` | `AudioCount` |
| `WebAudioReport.capacityRefusals` | `number` | `AudioCount` |
| `WebAudioReport.refusedTones` | `number` | `AudioCount` |
| `WebAudioReport.spontaneousStateChanges` | `number` | `AudioCount` |
| `WebAudioReport.unlockAttempts` | `number` | `AudioCount` |
| `WebAudioReport.unlockRefusals` | `number` | `AudioCount` |
| `WebAudioStreamSourceOptions.soundId` | `string` | `AudioSampleId` |

`FREE_MINECRAFT_MUSIC_TRACKS` remains a readonly array, but its exported element shape also changes in these six fields. These six rows are reported separately from the object and union member changes above.

| Exported constant element member | Base declaration | Head declaration |
| --- | --- | --- |
| `FREE_MINECRAFT_MUSIC_TRACKS[*].bpm` | `number` | `AudioBpm` |
| `FREE_MINECRAFT_MUSIC_TRACKS[*].eventId` | `string` | `MinecraftSoundEventId` |
| `FREE_MINECRAFT_MUSIC_TRACKS[*].notes` | `readonly [number, ...number[]]` | `readonly AudioNote[]` |
| `FREE_MINECRAFT_MUSIC_TRACKS[*].soundId` | `string` | `MinecraftSoundResourceId` |
| `FREE_MINECRAFT_MUSIC_TRACKS[*].volume` | `number` | `AudioGain` |
| `FREE_MINECRAFT_MUSIC_TRACKS[*].weight` | `number` | `AudioWeight` |

### Other exported alias and constant types

`MinecraftSoundPlayOptionsFailure` is returned when JavaScript callers supply an explicit invalid option, including `enabled: null`; omitted (`undefined`) `enabled` still defaults to `true`.

The declaration graph also changes these exported aliases and constants. The
`WEATHER_MODES` and `WeatherMode` changes remove `snow` by design; the numeric
constant values remain the same where their declared types now use brands.

| Export | Base declaration | 0.4 declaration |
| --- | --- | --- |
| `EndAudioClockFailure` | absent | `{ readonly _tag: 'EndAudioClockFailure' }` |
| `EndAudioSoundLimitFailure` | absent | `{ readonly _tag: 'EndAudioSoundLimitFailure' }` |
| `OriginalSampleBankFailure` | absent | `{ readonly _tag: 'OriginalSampleBankFailure'; readonly field: 'options' \| 'sampleRate' \| 'seed' \| 'soundId'; readonly message: AudioDiagnosticMessage }` |
| `MinecraftSoundPlayOptionsFailure` | absent | `{ readonly _tag: 'MinecraftSoundPlayOptionsFailure'; readonly field: 'durationSecs' \| 'frequency' \| 'enabled'; readonly message: AudioDiagnosticMessage }` |
| `CAPTION_LIFETIME_SECS` | absent | `AudioDurationSecs` |
| `CUE_DEFINITIONS` | `Record<SoundCueId, CueDefinition>` | `Readonly<Record<RawSoundCueId, CueDefinition>>` |
| `FREE_MINECRAFT_MUSIC_EVENT_VARIANTS` | `Readonly<Record<string, readonly FreeMusicEventVariant[]>>` | `ReadonlyMap<MinecraftSoundEventId, readonly FreeMusicEventVariant[]>` |
| `AudioSampleManifest` | `Readonly<Record<string, AudioSampleSource>>` | `ReadonlyMap<AudioSampleId, AudioSampleSource>` |
| `FreeMusicEventId` | `keyof typeof FREE_MINECRAFT_MUSIC_EVENT_VARIANTS` | `MinecraftSoundEventId` |
| `Minecraft26_2SoundEventId` | `` `minecraft:${Minecraft26_2SoundKey}` `` | `MinecraftSoundEventId` |
| `Minecraft26_3Snapshot9SoundEventId` | `` `minecraft:${Minecraft26_3Snapshot9SoundKey}` `` | `MinecraftSoundEventId` |
| `MinecraftBackgroundMusicInputEntry` | `MinecraftMusicDefinition \| Readonly<Record<string, never>>` | `unknown` |
| `MinecraftBackgroundMusicInput` | `Readonly<Partial<Record<MinecraftBackgroundMusicKey, MinecraftBackgroundMusicInputEntry>>>` | `Readonly<Partial<Record<MinecraftBackgroundMusicKey, unknown>>>` |
| `MinecraftBiomeMusicDefinition` | `{ readonly data: MinecraftMusicDefinition; readonly weight: number }` | `unknown` |
| `MinecraftBiomeMusic` | `readonly MinecraftBiomeMusicDefinition[]` | `readonly unknown[]` |
| `VolumeSettings[Category]` | `number` | `AudioVolume` |
| `WeatherMode` | `'clear' \| 'rain' \| 'thunder' \| 'snow'` | `'clear' \| 'rain' \| 'thunder'` |
| `WEATHER_MODES` | `readonly ['clear', 'rain', 'thunder', 'snow']` | `readonly ['clear', 'rain', 'thunder']` |
| `SOUND_CUE_IDS` | `readonly ['blockBreak', 'blockPlace', 'playerHurt', 'entityHit', 'mobHurt', 'mobDeath', 'enchant', 'inventoryOpen', 'itemPickup', 'inventoryClose', 'footstepGrass', 'footstepStone', 'footstepWood', 'rainAmbient', 'thunderClap', 'levelUp', 'achievementUnlock']` | `readonly SoundCueId[]` |
| `SoundCueId` | `(typeof SOUND_CUE_IDS)[number]` | `RawSoundCueId & Brand.Brand<'SoundCueId'>` |
| `WeatherLoopKind` | `'rain' \| 'wind'` | `'rain'` |
| `CAPTION_DISPLAY_SECS` | `2.5` | `AudioDurationSecs` |
| `DEFAULT_MAX_SIMULTANEOUS_END_SOUNDS` | `6` | `AudioCount` |
| `END_AMBIENCE_FADE_SECS` | `1.25` | `AudioDurationSecs` |
| `END_AMBIENCE_GAIN` | `0.18` | `AudioGain` |
| `END_EVENT_HISTORY_LIMIT` | `64` | `AudioCount` |
| `ATTACK_SECS` | `0.005` | `AudioDurationSecs` |
| `RELEASE_SECS` | `0.02` | `AudioDurationSecs` |
| `MIN_DURATION_SECS` | `0.01` | `AudioDurationSecs` |
| `MIN_FREQUENCY_HZ` | `20` | `AudioFrequencyHz` |
| `DEFAULT_CAVE_THRESHOLD_Y` | `40` | `PositionAxis` |
| `MINECRAFT_26_2_SOUND_EVENT_IDS` element | literal Minecraft 26.2 event ID | `MinecraftSoundEventId` |
| `MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_IDS` element | literal snapshot 9 event ID | `MinecraftSoundEventId` |
| `MINECRAFT_MUSIC_DEFAULT_MIN_DELAY_TICKS` | `12000` | `AudioDelayTicks` |
| `MINECRAFT_MUSIC_DEFAULT_MAX_DELAY_TICKS` | `24000` | `AudioDelayTicks` |
| `FREE_MUSIC_SAMPLE_RATE` | `22050` | `AudioSampleRate` |
| `FREE_MUSIC_DURATION_SECS` | `8` | `AudioDurationSecs` |
| `ORIGINAL_SAMPLE_RATE` | `16000` | `AudioSampleRate` |
| `ORIGINAL_SAMPLE_SOUND_IDS` element | literal cue ID union, `EndAudioEventKind`, or `'endAmbience'` | `SoundCueId`, `EndAudioEventKind`, or `'endAmbience'` |
| `OriginalSampleSoundId` | union including literal cue IDs | union including `SoundCueId` |
| `SPATIAL_DISTANCE_SCALE` | `12` | `AudioDistance` |
| `DEFAULT_MAX_CONCURRENT_TONES` | `32` | `AudioCount` |
| `WEATHER_FADE_SECS` | `0.75` | `AudioDurationSecs` |
| `SOUND_SPEED_BLOCKS_PER_SEC` | `343` | `number` |

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

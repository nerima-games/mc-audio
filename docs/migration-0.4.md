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

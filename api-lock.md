# API lock — @nerima-games/mc-audio

<!-- ------------------------------------------------------------------------- -->
<!-- GENERATED FILE. Do not edit by hand.                                      -->
<!--                                                                           -->
<!-- Regenerate with `pnpm api:update`. `pnpm api:check`, which `pnpm verify`  -->
<!-- runs, fails when this file is stale.                                      -->
<!--                                                                           -->
<!-- Every line below is part of the published surface of this package. A diff -->
<!-- here is a diff in what consumers can see, and is the thing plan.md §6     -->
<!-- Step 0-3 asks to be reviewed as a diff. See scripts/api-lock.ts for how   -->
<!-- it is produced and why it is produced this way.                           -->
<!-- ------------------------------------------------------------------------- -->

format: 1
exported declarations: 57
supporting declarations: 3

## Exported

### AUDIO_AVAILABILITIES  `const`

```ts
const AUDIO_AVAILABILITIES: readonly ["unavailable", "locked", "ready"];
```

### AudioAvailability  `type`

```ts
type AudioAvailability = (typeof AUDIO_AVAILABILITIES)[number];
```

### AudioBackend  `type`

```ts
type AudioBackend = {
    readonly availability: Effect.Effect<AudioAvailability>;
    readonly playTone: (request: ToneRequest) => Effect.Effect<ToneHandle>;
    readonly stopTone: (handle: ToneHandle) => Effect.Effect<void>;
    readonly setMasterGain: (gain: number) => Effect.Effect<void>;
};
```

### AudioBackendPort  `class`

```ts
class AudioBackendPort extends AudioBackendPort_base {
}
```

### CAPTION_DISPLAY_SECS  `const`

```ts
const CAPTION_DISPLAY_SECS = 2.5;
```

### CAPTION_REASONS  `const`

```ts
const CAPTION_REASONS: readonly ["audible", "muted", "gate-blocked", "unavailable"];
```

### CUE_DEFINITIONS  `const`

```ts
const CUE_DEFINITIONS: Record<SoundCueId, CueDefinition>;
```

### CaptionEvent  `type`

```ts
type CaptionEvent = {
    readonly cueId: SoundCueId;
    readonly text: string;
    readonly atSecs: number;
    readonly reason: CaptionReason;
    readonly pan?: number;
};
```

### CaptionReason  `type`

```ts
type CaptionReason = (typeof CAPTION_REASONS)[number];
```

### CaptionSink  `type`

```ts
type CaptionSink = {
    readonly emit: (event: CaptionEvent) => Effect.Effect<void>;
};
```

### CaptionStream  `class`

```ts
class CaptionStream extends CaptionStream_base {
}
```

### CueContext  `type`

```ts
type CueContext = {
    readonly settings: VolumeSettings;
    readonly enabled: boolean;
    readonly availability: AudioAvailability;
    readonly listener: Vec3;
};
```

### CueDefinition  `type`

```ts
type CueDefinition = {
    readonly baseGain: number;
    readonly caption: string | null;
    readonly spatial: boolean;
};
```

### CuePlan  `type`

```ts
type CuePlan = {
    readonly caption: Omit<CaptionEvent, 'atSecs'> | null;
    readonly tone: ToneRequest | null;
};
```

### CuePlayOptions  `type`

```ts
type CuePlayOptions = {
    readonly position?: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    };
    readonly gainScale?: number;
};
```

### DEFAULT_CAVE_THRESHOLD_Y  `const`

```ts
const DEFAULT_CAVE_THRESHOLD_Y = 40;
```

### DEFAULT_VOLUME_SETTINGS  `const`

```ts
const DEFAULT_VOLUME_SETTINGS: VolumeSettings;
```

### MAX_VISIBLE_CAPTIONS  `const`

```ts
const MAX_VISIBLE_CAPTIONS = 5;
```

### MUSIC_ENVIRONMENTS  `const`

```ts
const MUSIC_ENVIRONMENTS: readonly ["day", "night", "cave"];
```

### MUSIC_TRACKS  `const`

```ts
const MUSIC_TRACKS: Record<MusicEnvironment, MusicTrack>;
```

### MusicEnvironment  `type`

```ts
type MusicEnvironment = (typeof MUSIC_ENVIRONMENTS)[number];
```

### MusicEnvironmentContext  `type`

```ts
type MusicEnvironmentContext = {
    readonly playerY: number;
    readonly isNight: boolean;
    readonly caveThresholdY?: number;
};
```

### MusicPlan  `type`

```ts
type MusicPlan = {
    readonly shouldStopActiveTrack: boolean;
    readonly environmentToPlay: Option.Option<MusicEnvironment>;
};
```

### MusicTrack  `type`

```ts
type MusicTrack = {
    readonly frequency: number;
    readonly baseGain: number;
};
```

### NO_SPATIALISATION  `const`

```ts
const NO_SPATIALISATION: Spatialisation;
```

### RecordedBackend  `type`

```ts
type RecordedBackend = {
    readonly backend: AudioBackend;
    readonly played: Effect.Effect<ReadonlyArray<ToneRequest>>;
    readonly masterGains: Effect.Effect<ReadonlyArray<number>>;
};
```

### SOUND_CUE_IDS  `const`

```ts
const SOUND_CUE_IDS: readonly ["blockBreak", "blockPlace", "playerHurt", "itemPickup", "levelUp", "footstepGrass", "footstepStone", "inventoryOpen", "inventoryClose"];
```

### SPATIAL_DISTANCE_SCALE  `const`

```ts
const SPATIAL_DISTANCE_SCALE = 12;
```

### SoundCueId  `type`

```ts
type SoundCueId = (typeof SOUND_CUE_IDS)[number];
```

### SoundCuePort  `class`

```ts
class SoundCuePort extends SoundCuePort_base {
}
```

### SoundCueService  `type`

```ts
type SoundCueService = {
    readonly play: (cueId: SoundCueId, options?: CuePlayOptions) => Effect.Effect<void>;
};
```

### Spatialisation  `type`

```ts
type Spatialisation = {
    readonly gain: number;
    readonly pan: number;
};
```

### ToneHandle  `type`

```ts
type ToneHandle = {
    readonly id: number;
};
```

### ToneRequest  `type`

```ts
type ToneRequest = {
    readonly frequency: number;
    readonly durationSecs: number;
    readonly gain: number;
    readonly pan: number;
    readonly loop: boolean;
};
```

### UnavailableBackendLayer  `const`

```ts
const UnavailableBackendLayer: Layer.Layer<AudioBackendPort>;
```

### VOLUME_CATEGORIES  `const`

```ts
const VOLUME_CATEGORIES: readonly ["master", "sfx", "music"];
```

### Vec3  `type`

```ts
type Vec3 = {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};
```

### VolumeCategory  `type`

```ts
type VolumeCategory = (typeof VOLUME_CATEGORIES)[number];
```

### VolumeSettings  `type`

```ts
type VolumeSettings = {
    readonly [Category in VolumeCategory]: number;
};
```

### clamp01  `const`

```ts
const clamp01: (value: number) => number;
```

### clampPan  `const`

```ts
const clampPan: (value: number) => number;
```

### cueDefinition  `const`

```ts
const cueDefinition: (cueId: SoundCueId) => CueDefinition;
```

### currentAvailability  `const`

```ts
const currentAvailability: Effect.Effect<AudioAvailability, never, AudioBackendPort>;
```

### effectiveMusicGain  `const`

```ts
const effectiveMusicGain: (input: {
    readonly baseGain: number;
    readonly musicVolume: number;
}) => number;
```

### effectiveSfxGain  `const`

```ts
const effectiveSfxGain: (input: {
    readonly baseGain: number;
    readonly sfxVolume: number;
    readonly spatialGain: number;
    readonly gainScale?: number;
}) => number;
```

### firstCaptionFor  `const`

```ts
const firstCaptionFor: (events: ReadonlyArray<CaptionEvent>, cueId: SoundCueId) => Option.Option<CaptionEvent>;
```

### isSoundCueId  `const`

```ts
const isSoundCueId: (value: string) => value is SoundCueId;
```

### makeRecordingBackend  `const`

```ts
const makeRecordingBackend: (availability: AudioAvailability) => Effect.Effect<RecordedBackend>;
```

### makeSoundCueService  `const`

```ts
const makeSoundCueService: (input: {
    readonly context: Effect.Effect<CueContext>;
    readonly nowSecs: Effect.Effect<number>;
}) => Effect.Effect<SoundCueService, never, AudioBackendPort | CaptionStream>;
```

### masterNodeGain  `const`

```ts
const masterNodeGain: (settings: VolumeSettings) => number;
```

### musicTrackGain  `const`

```ts
const musicTrackGain: (environment: MusicEnvironment, musicVolume: number) => number;
```

### planCue  `const`

```ts
const planCue: (cueId: SoundCueId, context: CueContext, options?: CuePlayOptions) => CuePlan;
```

### recordingCaptionLayer  `const`

```ts
const recordingCaptionLayer: (sink: (event: CaptionEvent) => Effect.Effect<void>) => Layer.Layer<CaptionStream>;
```

### resolveMusicEnvironment  `const`

```ts
const resolveMusicEnvironment: (context: MusicEnvironmentContext) => MusicEnvironment;
```

### resolveMusicPlan  `const`

```ts
const resolveMusicPlan: (input: {
    readonly enabled: boolean;
    readonly active: Option.Option<MusicEnvironment>;
    readonly desired: MusicEnvironment;
}) => MusicPlan;
```

### spatialise  `const`

```ts
const spatialise: (listener: Vec3, source: Vec3) => Spatialisation;
```

### visibleCaptions  `const`

```ts
const visibleCaptions: (events: ReadonlyArray<CaptionEvent>, nowSecs: number) => ReadonlyArray<CaptionEvent>;
```

## Supporting declarations

Not exported from the barrel, but named by the signatures above, so a
consumer is exposed to them. `Context.Tag` service classes emit their real
type onto one of these.

### AudioBackendPort_base  `const`

```ts
const AudioBackendPort_base: Context.TagClass<AudioBackendPort, "@nerima-games/mc-audio/AudioBackendPort", AudioBackend>;
```

### CaptionStream_base  `const`

```ts
const CaptionStream_base: Context.TagClass<CaptionStream, "@nerima-games/mc-audio/CaptionStream", CaptionSink>;
```

### SoundCuePort_base  `const`

```ts
const SoundCuePort_base: Context.TagClass<SoundCuePort, "@nerima-games/mc-audio/SoundCuePort", SoundCueService>;
```

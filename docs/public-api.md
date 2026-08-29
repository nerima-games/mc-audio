# 公開 API

plan.md §3.6 の要求を出発点に、現行 package の `src/index.ts` と `src/domain/*` の公開契約を
**参照実装の移植根拠と突き合わせて**確定させたもの。`packages/game/*` などのパスは移植元の
根拠であり、現行 package の実装パスではない。

## 0. plan.md が要求している API

> **主要な公開 API**: `SoundCuePort`（`play(cueId, options)`）、字幕イベントの `CaptionStream`、
> 音量カテゴリ（master/sfx/music）、Minecraft `sounds.json` レジストリ、WebAudio アダプタ

---

## 1. キューレジストリ

```typescript
export const SOUND_CUE_IDS: readonly ['blockBreak', 'blockPlace', 'playerHurt', ...]
export type SoundCueId = (typeof SOUND_CUE_IDS)[number]
export const isSoundCueId: (value: string) => value is SoundCueId

export type CueDefinition = {
  readonly baseGain: number
  readonly caption: string | null
  readonly spatial: boolean
}
export const CUE_DEFINITIONS: Record<SoundCueId, CueDefinition>
export const cueDefinition: (cueId: SoundCueId) => CueDefinition
```

`src/domain/cue.ts`。**リテラル型のユニオン**であって opaque な id ではない。
キューを追加したら、全ての `switch` がコンパイルエラーになってほしいからである。

参照実装も同じ判断をしており、ユニオンとテーブルの対応を 1 行で強制していた
（`packages/game/application/sound-manager.types.ts:31`）:

```typescript
SOUND_LIBRARY satisfies Record<SoundEffect, unknown>
```

mc-audio では `CUE_DEFINITIONS` を `Record<SoundCueId, CueDefinition>` と宣言することで
**両方向**に強制している（定義漏れも余りも型エラー）。

### 現在のロスター

参照実装は 17 キュー（`sound-manager.types.ts:4-23`）。
mc-audio も 17 個のキューを公開している。キューを発火する gameplay ルールは
`mx-gameplay` 側の責務であり、このレジストリとは分離する。

### `caption: null` の意味

「意図的に字幕を付けない」である。ゲートで消えたのではない。
参照実装は `inventoryOpen` / `inventoryClose` の 2 つをそう扱っていた
（`packages/presentation/hud/sound-captions.ts:11-29`）。
プレイヤーが自分でキーを押して出した UI 音を読み上げても情報が無く、
情報のある字幕を押し出してしまう。

---

## 2. 音量カテゴリと gain 算術

```typescript
export const VOLUME_CATEGORIES: readonly ['master', 'sfx', 'music']
export type VolumeCategory = (typeof VOLUME_CATEGORIES)[number]
export type VolumeSettings = { readonly [C in VolumeCategory]: number }
export const DEFAULT_VOLUME_SETTINGS: VolumeSettings   // { master: 0.8, sfx: 1, music: 0.55 }

export const clamp01: (value: number) => number
export const clampNonNegative: (value: number) => number
export const clampPan: (value: number) => number
export const SPATIAL_DISTANCE_SCALE = 12
export const spatialise: (listener: Position, source: Position, options?: SpatialisationOptions) => Spatialisation
export const minecraftSpatialise: (listener: Position, source: Position, options?: SpatialisationOptions) => Spatialisation
export const NO_SPATIALISATION: Spatialisation

export const effectiveSfxGain: (input: {
  readonly baseGain: number
  readonly sfxVolume: number
  readonly spatialGain: number
  readonly gainScale?: number
}) => number

export const effectiveMusicGain: (input: {
  readonly baseGain: number
  readonly musicVolume: number
}) => number

export const masterNodeGain: (settings: VolumeSettings) => number
```

`src/domain/volume.ts`。**`master` はどの per-cue 計算にも入っていない。**
理由は [design-notes.md](./design-notes.md#dn-2)。

### 参照実装の算術（そのまま移植）

SFX（`packages/game/application/sound-manager-playback.ts:31-36`）:

```
gain = clampNonNegative(baseGain × sfxVolume × spatial.gain × max(0, gainScale ?? 1))
```

音楽（`packages/game/application/music-manager-runtime.ts:70-71`）:

```
gain = clampNonNegative(trackBaseGain × musicVolume)
```

空間化（`packages/game/domain/sound-spatial.ts:11-27`、`SPATIAL_DISTANCE_SCALE = 12`）:

```
attenuation = 1 / (1 + distance / 12)
pan         = clampPan(dx / 12)
```

逆二乗ではなく `1/(1+d/s)` なのは、ゼロにならない（遠い音が切れずにフェードする）ことと
d = 0 で有限であることの両方が要るためである。

Minecraft の `sounds.json` variant は `attenuation_distance` を持つため、プレイヤーでは
`minecraftSpatialise` を使う。こちらの gain は `clamp01(1 - distance / attenuation_distance)`
という線形 cutoff であり、汎用 cue の「遠くてもゼロにならない」`spatialise` とは意図的に分離している。
距離と pan の座標計算、`distance_offset`、listener の向きの扱いは共有する。

最終的な振幅:

```
汎用 SFX = clampNonNegative(baseGain × sfxVolume × 1/(1+d/12) × max(0, gainScale)) × clamp01(masterVolume)
音楽 = clampNonNegative(trackBaseGain × musicVolume)                              × clamp01(masterVolume)
                                                                        └─ master ノードが 1 回だけ
```

`clamp01` はユーザー設定・カテゴリ・master の境界に使う。Minecraft の
`sounds.json` には `volume: 4.0` のように unity を超える公式イベント値もあるため、
イベント単位の最終 gain は `clampNonNegative` で有限値と非負値だけを保証する。

### 既定値の根拠

`packages/game/application/settings-service.ts:35-37`:
master `0.8` / sfx `1.0` / music `0.55`。

音楽が sfx より大幅に低いのは、音楽が連続音で sfx が過渡音だからである。
同じ公称レベルにすると音楽が知覚的に支配する。

---

## 3. `AudioBackendPort` とオーディオゲート

```typescript
export const AUDIO_AVAILABILITIES: readonly ['unavailable', 'locked', 'ready']
export type AudioAvailability = (typeof AUDIO_AVAILABILITIES)[number]

export type ToneRequest = {
  readonly soundId?: string
  readonly playbackRate?: number
  readonly frequency: number
  readonly wave?: 'sine' | 'square' | 'sawtooth' | 'triangle'
  readonly durationSecs: number
  readonly gain: number
  readonly pan: number
  readonly loop: boolean
  readonly stream?: boolean
  readonly naturalDuration?: boolean
  readonly sampleOnly?: boolean
}
export type MusicRequest = {
  readonly soundId: string
  readonly gain: number
  readonly playbackRate: number
  readonly stream: boolean
}
export type ToneHandle = { readonly id: number }
export type TonePlayback = ToneHandle & { readonly accepted: boolean }

export type AudioBackend = {
  readonly availability: Effect.Effect<AudioAvailability>
  readonly playTone: (request: ToneRequest) => Effect.Effect<TonePlayback>
  readonly playMusic: (request: MusicRequest) => Effect.Effect<TonePlayback>
  readonly stopTone: (handle: ToneHandle) => Effect.Effect<void>
  readonly setToneGain: (handle: ToneHandle, gain: number) => Effect.Effect<void>
  readonly isToneActive: (handle: ToneHandle) => Effect.Effect<boolean>
  readonly setMasterGain: (gain: number) => Effect.Effect<void>
}

export class AudioBackendPort extends Context.Tag('@nerima-games/mc-audio/AudioBackendPort')<...>() {}

export const makeRecordingBackend: (availability: AudioAvailability) => Effect.Effect<RecordedBackend>
export const UnavailableBackendLayer: Layer.Layer<AudioBackendPort>
```

`src/domain/backend-port.ts`。低レベルの合成音契約に加えて、WebAudio 実装は
`AudioSampleManifest`（URL または `ArrayBuffer`）を decode/cache/preload できる。

### `availability` が値であることが要点

参照実装には音が鳴らない理由が 3 つあり、**どれも区別できなかった**:

| # | 理由 | 場所 |
| --- | --- | --- |
| 1 | 設定ゲート（`audioEnabled === false`） | `sound-manager-playback.ts:19-21` |
| 2 | `AudioContext` がそもそも無い | `audio-engine.ts:42-44` |
| 3 | ブラウザの自動再生ポリシー | `audio-engine.ts:46-49` |

3 番目が特に問題である。参照実装のコードは:

```typescript
yield* Effect.tryPromise({
  try: () => context.resume(),
  catch: () => new Error('AudioContext resume failed'),
}).pipe(Effect.catchAllCause(() => Effect.void))
```

`resume()` の拒否（ユーザジェスチャが無いのでブラウザが拒む）を
`Effect.void` に飲み込み、そのままオシレータノードを組み立てる。
音は永久に鳴らないが、上位からは観測できない。

**ユーザジェスチャによるアンロック機構、`unlocked` フラグ、保留キューは
参照実装全体に存在しない**。mc-audio では `locked` を公開状態として扱う。

`locked` という状態に名前を付けることで、字幕が `gate-blocked` と自己申告でき、
UI が「クリックして音を有効化」と出せるようになる。

### 再生受理とハンドルは別の値

参照実装は `playTone` の id を**コンテキストゲートより前**に採番していた
（`audio-engine.ts:40` で採番、`:42` でゲート）。
つまりオーディオが無くても id は単調に増える。

**「ハンドルが返ってきた＝音が鳴った」と判断してはならない。**
mc-audio は `TonePlayback.accepted` を再生要求の受理結果として公開する。
`false` のときはノードや音源が再生可能な状態になっておらず、`id` は診断用の
単調増加値にすぎない。上位プレイヤーも `accepted === true` のときだけ
`played` や字幕の audible 判定に進む。`availability` は、再生を要求する前に
`locked` や `unavailable` を設定ゲートとして区別するために引き続き使う。

---

## 4. 字幕イベントストリーム

```typescript
export const CAPTION_REASONS: readonly ['audible', 'muted', 'gate-blocked', 'unavailable']
export type CaptionReason = (typeof CAPTION_REASONS)[number]

export type CaptionEvent = {
  readonly cueId: SoundCueId
  readonly text: string
  readonly atSecs: number      // monotonic。壁時計でも performance.now() でもない
  readonly reason: CaptionReason
  readonly pan?: number        // 空間キューのみ
}

export type CaptionSink = { readonly emit: (event: CaptionEvent) => Effect.Effect<void> }
export class CaptionStream extends Context.Tag('@nerima-games/mc-audio/CaptionStream')<...>() {}

export const CAPTION_DISPLAY_SECS = 2.5
export const MAX_VISIBLE_CAPTIONS = 5
export const visibleCaptions: (events: ReadonlyArray<CaptionEvent>, nowSecs: number)
  => ReadonlyArray<CaptionEvent>
```

`src/domain/caption.ts`。

### 参照実装との差

参照実装の `SoundCaptionPort`（`packages/game/application/sound-caption-port.ts:8-15`）:

```typescript
export type SoundCaptionPortShape = {
  readonly announce: (effect: SoundEffect) => Effect.Effect<void, never>
}
```

**イベントは素のキュー ID だけ**である。タイムスタンプも位置も音量も無い。

その結果、字幕消費に必要なロジックが全部 DOM コードに入った
（`packages/presentation/hud/sound-captions.ts`）:

| ロジック | 場所 | 問題 |
| --- | --- | --- |
| ラベルによる重複排除 | `:66-70` | モジュールレベルの mutable `Map`（`:34`） |
| 5 行の上限 | `:72-76` | 同上 |
| 2500ms の期限切れ | `:6`, `:82` | 生の `setTimeout`。テストに fake timer が要る |
| 有効/無効 | `:33`, `:44` | モジュールレベルの `let captionsEnabled` |

DOM 無しの consumer（字幕エクスポータ、スクリーンリーダーブリッジ）は何も再利用できない。

`atSecs` を付けたことで期限切れと重複排除が**イベント列の純関数**になり、
`visibleCaptions` として DOM の外に出た。
DOM 側は描画だけをする。

### `reason` があること自体が契約

`muted` / `gate-blocked` / `unavailable` の 3 つは
「音は鳴らなかったが字幕は出した」ことの記録である。
これがテスト可能な形の accessibility 契約になっている。

---

## 5. `SoundCuePort` と `planCue`

```typescript
export type CueContext = {
  readonly settings: VolumeSettings
  readonly enabled: boolean            // プレイヤーの ON/OFF。availability とは別物
  readonly availability: AudioAvailability
  readonly listener: Position
  readonly listenerForward?: Position   // 水平視線方向。省略時は world +X が右
}

export type CuePlan = {
  readonly caption: Omit<CaptionEvent, 'atSecs'> | null
  readonly tone: ToneRequest | null
}

export const planCue: (cueId: SoundCueId, context: CueContext, options?: CuePlayOptions) => CuePlan

export type SoundCueService = {
  readonly play: (cueId: SoundCueId, options?: CuePlayOptions) => Effect.Effect<void>
}
export class SoundCuePort extends Context.Tag('@nerima-games/mc-audio/SoundCuePort')<...>() {}

export const makeSoundCueService: (input: {
  readonly context: Effect.Effect<CueContext>
  readonly nowSecs: Effect.Effect<number>
}) => Effect.Effect<SoundCueService, never, AudioBackendPort | CaptionStream>
```

`src/domain/engine.ts`。

**決定を純関数 `planCue` に分離してある**ので、
「caption は無条件に計算され、tone だけがゲートで潰される」ことが
コードを読むだけで確認できる。

参照実装にも純粋なプランナはあったが（`sound-manager-playback.ts:11-18`）、
**字幕はその外側**にあった。だから両者の関係は文の順序だけで表現されていた。

### `nowSecs` が引数である理由

低レベルの `makeSoundCueService` は純粋な依存注入を保つため、時計を
`Effect<number>` として受け取る。高レベルの `makeMinecraftSoundPlayer` は
mc-kernel の `ClockPort.monotonicSecs` を直接利用してこの依存を配線する。
いずれも monotonic 秒であり、壁時計でも `performance.now()` でもない
（`performance.now()` は `pnpm check:deps` が禁止している）。

---

## 6. BGM 状態機械

Minecraft のデータ駆動 BGM は次の公開 API で扱う。

```typescript
export const makeMinecraftMusicPlayer: (
  registry: MinecraftSoundRegistry,
  randomSource: () => number,
) => Effect.Effect<MinecraftMusicPlayer, never, AudioBackendPort>

export const makeMinecraftSoundPlayer: (
  registry: MinecraftSoundRegistry,
  randomSource: () => number,
) => Effect.Effect<
  MinecraftSoundPlayer,
  never,
  AudioBackendPort | CaptionStream | ClockPort
>
```

`randomSource` は必須で、variant 選択と BGM の待ち時間をゲーム側の乱数サービスへ接続する。
暗黙の `Math.random` は公開 API の依存境界に置かない。

```typescript
export const MUSIC_ENVIRONMENTS: readonly ['day', 'night', 'cave']
export type MusicEnvironment = (typeof MUSIC_ENVIRONMENTS)[number]
export const DEFAULT_CAVE_THRESHOLD_Y = 40

export const resolveMusicEnvironment: (context: {
  readonly playerY: number
  readonly isNight: boolean
  readonly caveThresholdY?: number
}) => MusicEnvironment

export type MusicPlan = {
  readonly shouldStopActiveTrack: boolean
  readonly environmentToPlay: Option.Option<MusicEnvironment>
}
export const resolveMusicPlan: (input: {
  readonly enabled: boolean
  readonly active: Option.Option<MusicEnvironment>
  readonly desired: MusicEnvironment
}) => MusicPlan

export const MUSIC_TRACKS: Record<MusicEnvironment, MusicTrack>
export const musicTrackGain: (environment: MusicEnvironment, musicVolume: number) => number
```

`src/domain/music.ts`。参照実装の構造をそのまま移植した
（`music-manager-environment.ts:10-15`、`music-manager-state.ts:21-43`）。

### 環境判定

```
playerY < caveThresholdY  → 'cave'      （cave が day/night に勝つ、比較は厳密な <）
isNight                   → 'night'
otherwise                 → 'day'
```

`DEFAULT_CAVE_THRESHOLD_Y = 40`（`music-manager.config.ts:15`）は
mc-worldgen の `SEA_LEVEL = 63` より下なので、浜辺に立っているプレイヤーが
誤って「地下」判定されることはない。

`<` が `<=` でないことは重要である → [design-notes.md](./design-notes.md#dn-4)。

### 遷移計画は 4 通りしかない

| enabled | active | desired | 結果 |
| --- | --- | --- | --- |
| false | Some | * | stop、再生なし |
| false | None | * | 何もしない |
| true | Some(X) | X | **何もしない**（再起動しない） |
| true | * | Y≠X | stop（active があれば）+ Y を再生 |

3 行目が重要である → [design-notes.md](./design-notes.md#dn-5)。

### トラック定義

`music-manager.config.ts:9-13` より:
day 174.61Hz sine gain 0.28 / night 130.81Hz triangle 0.24 / cave 98.0Hz sawtooth 0.2。

参照実装は `durationMs: 2000` かつ `loop: true` で再生していたが、
エンジンは `loop` が真なら `oscillator.stop(...)` を呼ばないので
（`audio-engine.ts:103-105`）、BGM の `durationMs` は**無効**である。

### Java `ambient_sounds`

```typescript
export type MinecraftAmbientSoundsDefinition = {
  readonly loop?: string
  readonly mood?: MinecraftAmbientMood
  readonly additions?: readonly MinecraftAmbientAddition[]
}
export type MinecraftAmbientMoodResolution = {
  readonly delayTicks: number
  readonly position: Position | null
}
export type MinecraftAmbientMoodResolver = (input: {
  readonly cameraPosition: Position
  readonly mood: MinecraftAmbientMood
  readonly randomSource: () => number
  readonly tick: number
}) => MinecraftAmbientMoodResolution | null
export type MinecraftAmbientSoundsPlannerInput = {
  readonly cameraPosition: Position
  readonly definition?: MinecraftAmbientSoundsDefinition | null
  readonly moodResolver?: MinecraftAmbientMoodResolver
  readonly randomSource: () => number
  readonly state: MinecraftAmbientSoundsState
  readonly tick: number
}

export const normalizeMinecraftAmbientSoundsDefinition: (
  definition?: MinecraftAmbientSoundsDefinition | null,
) => NormalizedMinecraftAmbientSoundsDefinition
export const initialMinecraftAmbientSoundsState: () => MinecraftAmbientSoundsState
export const planMinecraftAmbientSounds: (
  input: MinecraftAmbientSoundsPlannerInput,
) => MinecraftAmbientSoundsPlan

export const makeMinecraftAmbientSoundsPlayer: (
  registry: MinecraftSoundRegistry,
  randomSource: () => number,
) => Effect.Effect<MinecraftAmbientSoundsPlayer, never, AudioBackendPort>
```

`loop`、`mood.sound`、`mood.tick_delay`、`mood.block_search_extent`、`mood.offset`、
`additions[].tick_chance` は公式の `minecraft:audio/ambient_sounds` フィールドである。
planner は loop の切替、mood の次回 tick、addition の抽選だけを決定する。
`moodResolver` は mood が camera 位置で due になったときだけ呼ばれ、正規化済みの
`block_search_extent`、`tick_delay`、`offset` と注入された乱数源を受け取る。呼び出し側は
world/block の光量サンプリングと暗さに応じた判定を行い、再生位置と次回判定までの
`delayTicks` を返す。`position: null` または resolver 自体の省略はその mood 音を抑制するが、
スケジューラの次回 tick は進む。`mc-kernel` に world/light lookup port がないため、
音声ライブラリは vanilla の探索式を推測で埋めない。planner は `mood.offset` を command
に保持し、player が追加距離として減衰に適用する。

---

<a id="webaudio"></a>
## 7. WebAudio アダプタ（実装済み）

```typescript
export type WebAudioGlobalSurface = {
  readonly AudioContext?: AudioContextConstructorSurface | undefined
}
export type WebAudioOptions = {
  readonly global: WebAudioGlobalSurface
  readonly initialMasterGain?: number
  readonly maxConcurrentTones?: number  // default: 32
  readonly resolveAudioBuffer?: (soundId: string) => AudioBufferSurface | null
  readonly sampleManifest?: AudioSampleManifest
  readonly loadSampleData?: (url: string) => Promise<ArrayBuffer>
}
export type WebAudioBackend = AudioBackend & {
  readonly preloadSamples: (sampleIds?: ReadonlyArray<string>) => Effect.Effect<AudioSampleLoadReport>
  readonly unlock: Effect.Effect<AudioAvailability>   // ユーザジェスチャから呼ぶ
  readonly report: Effect.Effect<WebAudioReport>
  readonly setMuted: (muted: boolean) => Effect.Effect<void>
  readonly dispose: Effect.Effect<void>               // 冪等、以後は再生成しない
}
export const makeWebAudioBackend: (options: WebAudioOptions) => Effect.Effect<WebAudioBackend>
export const webAudioBackendLayer: (options: WebAudioOptions) => Layer.Layer<AudioBackendPort>
export const availabilityForState: (state: AudioContextStateSurface) => AudioAvailability
export const DEFAULT_TONE_WAVE: OscillatorWave
```

`src/domain/webaudio-adapter.ts`。

### `lib: ["DOM"]` は**必要にならなかった**

この節の以前の版は「`lib: ["DOM"]` が必要になるため入れていない」と書いていた。
実際には要らなかった。`src/domain/webaudio-surface.ts` が
アダプタが使うメンバだけを構造的に記述し、
`test/webaudio-surface.test.ts` が fixture を**本物の `lib.dom.d.ts`** に対して
コンパイルして「実 `AudioContext` がキャスト無しで満たす」ことを証明している。

構造的に書けなかったのは `AudioNode.connect` **1 つだけ**で、
その理由（反変にすると `AudioNode` 全体を記述する羽目になる）と
メソッド構文の双変性が何を失うかは同ファイルのヘッダに書いてある。

### `globalThis` を引数で受け取る

```typescript
makeWebAudioBackend({ global: globalThis })   // ブラウザ
makeWebAudioBackend({ global: { AudioContext: undefined } })  // Node
```

参照実装は `typeof AudioContext === 'undefined'` を**エンジンの中**で読んでいた。
そのせいで Node のテストからは偽にできず、
`audio-engine.ts` と `audio-context-helpers.ts` のテストが 0 本になった。
feature detection はアダプタの責務だが、**どこを見るか**は呼び出し側が渡す。

### `webAudioBackendLayer` が捨てるもの

`preloadSamples` / `unlock` / `report` / `setMuted` / `dispose` は `AudioBackend` に無いので、
**この Layer 経由だけで配線した consumer は context をアンロックできない**（永久に `locked`）。

これは実在する落とし穴で、隠さずに置いてある。
`AudioBackendPort` に `unlock` を足すと、下流の全リポジトリの全 fake が
「自動再生ポリシーを持っているふり」を実装させられる。
音を出したいホストは `makeWebAudioBackend` を 1 回呼んで値を保持し、
`unlock` を最初のクリックハンドラに渡し、残りを Layer として提供する。
配線は mc-compose の仕事である（`docs/porting.md` §4）。

### 参照実装から移植した内容

参照実装の `AudioContext` 生成（`packages/game/infrastructure/audio-context-helpers.ts:3-24`）:

```typescript
export const acquireAudioContext = (): Effect.Effect<Option.Option<AudioContext>, never> => {
  if (typeof AudioContext === 'undefined') {
    return Effect.succeed(Option.none())
  }
  return Effect.gen(function* () {
    const ctx = yield* Effect.try({
      try: () => new AudioContext(),
      catch: () => new Error('AudioContext creation failed'),
    })
    return Option.some(ctx)
  }).pipe(Effect.catchAllCause(() => Effect.succeed(Option.none())))
}
```

feature detection + `Effect.try` + `catchAllCause` で、**決して失敗しない** `Option` を返す。
この形は良いのでそのまま持ってくる。

生成は遅延（最初の `playTone` 時、`audio-engine.ts:22-36` の `ensureContext`）。
ノードの後始末も同様にガードしてある（`safeDisconnect` `:26-30`、`safeStop` `:32-36`）。

### 新規に作ったもの（参照実装に存在しない）

| # | 項目 | 決定 |
| --- | --- | --- |
| 1 | ユーザジェスチャによるアンロック | `unlock`。`resume()` の**解決を信用せず** `state` を読み直す（Safari は suspended のまま解決する） |
| 2 | 保留キュー | **作らない。捨てる。** 理由は [design-notes.md](./design-notes.md#dn-6)。捨てた数は `WebAudioReport.refusedTones` |
| 3 | サンプル再生 | `AudioSampleManifest` の URL / `ArrayBuffer` を decode/cache/preload し、`soundId` があればサンプルを優先する。未登録時は正弦波へフォールバック |

### エンベロープ（参照実装に無い、が入れた）

`src/domain/envelope.ts`。参照実装は `gain.value` をフラットに置いて
`oscillator.stop(...)` で切っていた（`audio-engine.ts:59`, `:104`）ので、
波形が任意の位相で切れて**全キューにクリックが乗る**。
attack 5ms / release 20ms のランプで消してある。

エラーにならず、テストも赤くならず、「なんか安っぽい」としてしか現れない種類の欠陥である。

### キューごとの波形

`CueDefinition.wave` は `planCue` から `ToneRequest.wave` へ渡り、WebAudio の
`OscillatorNode.type` まで到達する。キュー以外の呼び出し元が波形を省略した場合だけ
`DEFAULT_TONE_WAVE = 'sine'` を使う。

### 時刻の扱い

WebAudio のスケジューリングは `AudioContext.currentTime` を使う
（`audio-engine.ts:104`）。これは壁時計ではないので `Date.now()` 禁止に抵触しない。

もし `performance.now()` が必要になったら、その行に
`mc-kernel-allow-time-source` コメントを付けて逃がすこと
（`scripts/check-dependency-whitelist.ts` の `TIME_SOURCE_ESCAPE_HATCH`）。

---

## 8. Minecraft のデータ駆動音声

```typescript
export const parseMinecraftSoundsJson: (
  value: unknown,
  options: MinecraftSoundRegistryOptions,
) => MinecraftSoundRegistry
export const mergeMinecraftSoundRegistries: (
  base: MinecraftSoundRegistry,
  overlay: MinecraftSoundRegistry,
) => MinecraftSoundRegistry
export const resolveMinecraftSound: (
  registry: MinecraftSoundRegistry,
  eventId: string,
  random?: number,
) => ResolvedMinecraftSound
export const minecraftSoundManifest: (
  registry: MinecraftSoundRegistry,
  baseUrl: string,
) => AudioSampleManifest
export const mergeAudioSampleManifests: (
  base: AudioSampleManifest,
  additions: AudioSampleManifest,
) => AudioSampleManifest
export const planMinecraftSound: (
  registry: MinecraftSoundRegistry,
  eventId: string,
  options: MinecraftSoundPlayOptions,
) => MinecraftSoundPlaybackPlan
```

`src/domain/minecraft-sounds-*` は公式 `sounds.json` の `sounds` 配列と、文字列／オブジェクト
variant、`type`、`volume`、`pitch`、`weight`、`stream`、`preload`、
`attenuation_distance`、`subtitle`、`replace` を扱う。event variant の参照と循環検出、
重み付き選択、URL／`ArrayBuffer` のサンプル境界は parser・resolver・WebAudio adapter に
分離してある。実際の OGG はライブラリに埋め込まず、ホストが合法なリソースパックを
`AudioSampleManifest` として渡す。

26.2 の 1,968 件の公式イベントカタログは `MINECRAFT_26_2_SOUND_EVENT_GROUPS`、
`MINECRAFT_26_2_SOUND_EVENT_IDS`、`missingMinecraft26_2SoundEvents` で検査できる。
`MINECRAFT_26_2_SOUNDS_JSON` は公式 `sounds.json` 全イベントの定義本体を保持し、
`createMinecraft26_2SoundRegistry()` はそれを通常の `MinecraftSoundRegistry` に変換する。
ブロック、Sulfur Cube 系エンティティ、Sulfur Cube 用バケツなどのイベント定義を含み、
公式の空イベントも識別子とともに保持するが、音声バイナリの再配布ではない。

26.3 Snapshot 9 の 1,991 件の検証版カタログは、`MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_GROUPS`、
`MINECRAFT_26_3_SNAPSHOT_9_SOUND_EVENT_IDS`、`missingMinecraft26_3Snapshot9SoundEvents`、
`MINECRAFT_26_3_SNAPSHOT_9_SOUNDS_JSON`、`createMinecraft26_3Snapshot9SoundRegistry()` で
利用できる。これは 26.2 から独立した pre-release API であり、stable API の互換 alias ではない。
Snapshot 用 resource pack と組み合わせる場合にだけ選択する。

`FREE_MINECRAFT_MUSIC_TRACKS` と `FREE_MINECRAFT_MUSIC_EVENT_VARIANTS` は、
`createFreeMinecraftMusicPack()` が生成する、26.2 の全公式音楽イベント配置へ追加可能なフリーの
合成代替音源である。イベント ID、variant 順序、重み、音量、`stream`、event 参照は保持するが、
生成音は Mojang／Minecraft の原曲波形と同一ではない。原音との完全一致が必要な配布物では、権利を確認した
公式音源またはリソースパックを注入する。

`mergeAudioSampleManifests(base, additions)` は、同じ `soundId` がある場合に base を優先し、
resource pack の追加音源だけを安全に統合する。

mob の標準 variant は `parseMinecraftMobSoundVariantJson`、
`resolveMinecraftMobSoundVariant`、`resolveMinecraftWolfSound`、ambient と firefly は
`normalizeMinecraftAmbientSoundsDefinition`、`planMinecraftAmbientSounds`、
`canPlayMinecraftFireflyBushIdleSounds` が担当する。

## 9. その他の root exports

`src/index.ts` は、上記の主要契約に加えて次の実装単位も root export している。

| モジュール | 主な公開面 | 責務 |
| --- | --- | --- |
| `src/domain/end-audio.ts` / `end-audio-controller.ts` | `planEndAudio`、`makeEndAudioController` | End のイベント、ループ、Dragon Battle の音声状態 |
| `src/domain/footstep.ts` | `footstepCueFor` | ブロック表面から足音キューを選ぶ純関数 |
| `src/domain/game-audio.ts` | `makeGameAudioHost` | ゲームイベントを音声・字幕 Port へ接続する host |
| `src/domain/weather-ambience.ts` / `weather-audio-controller.ts` | `planWeatherAmbience`、`makeWeatherAudioController` | 雨・雪・雷のループと遷移 |
| `src/domain/minecraft-audio.ts` | `parseMinecraftAudioComponent`、`normalizeMinecraftAudioComponent` | `minecraft:audio/*` component の解析・正規化 |
| `src/domain/audio-sample.ts` | `AudioSampleManifest`、`mergeAudioSampleManifests` | リソースパック音源の manifest 境界 |
| `src/domain/original-sample-bank.ts` / `free-music-bank.ts` | `createOriginalSampleManifest`、`createFreeMinecraftMusicPack` | 権利を持つ音源を注入するための生成 helper |

root export の完全な機械的な一覧は `src/index.ts` を正とする。この表は各モジュールの利用目的を示し、
音声バイナリやブラウザ固有の型を公開契約に混ぜないという境界を補足する。

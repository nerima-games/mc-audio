# 公開 API

plan.md §3.6 が要求する API を、**参照実装の実コードと突き合わせて**確定させたもの。
根拠パスは全て `ts-minecraft` リポジトリ内の実在するファイル・行である。

## 0. plan.md が要求している API

> **主要な公開 API**: `SoundCuePort`（`play(cueId, options)`）、`MusicContextPort`、
> `CaptionEventStream`（UI が購読）、音量カテゴリ（master/sfx/music）

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

`domain/cue.ts`。**リテラル型のユニオン**であって opaque な id ではない。
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
mc-audio は代表 9 個の暫定ロスターである。
**最終ロスターはキューを発火する gameplay ルールと一緒に確定する。**

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
export const clampPan: (value: number) => number
export const SPATIAL_DISTANCE_SCALE = 12
export const spatialise: (listener: Vec3, source: Vec3) => Spatialisation
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

`domain/volume.ts`。**`master` はどの per-cue 計算にも入っていない。**
理由は [design-notes.md](./design-notes.md#dn-2)。

### 参照実装の算術（そのまま移植）

SFX（`packages/game/application/sound-manager-playback.ts:31-36`）:

```
gain = clamp01(baseGain × sfxVolume × spatial.gain × max(0, gainScale ?? 1))
```

音楽（`packages/game/application/music-manager-runtime.ts:70-71`）:

```
gain = clamp01(trackBaseGain × musicVolume)
```

空間化（`packages/game/domain/sound-spatial.ts:11-27`、`SPATIAL_DISTANCE_SCALE = 12`）:

```
attenuation = 1 / (1 + distance / 12)
pan         = clampPan(dx / 12)
```

逆二乗ではなく `1/(1+d/s)` なのは、ゼロにならない（遠い音が切れずにフェードする）ことと
d = 0 で有限であることの両方が要るためである。

最終的な振幅:

```
SFX  = clamp01(baseGain × sfxVolume × 1/(1+d/12) × max(0, gainScale)) × clamp01(masterVolume)
音楽 = clamp01(trackBaseGain × musicVolume)                            × clamp01(masterVolume)
                                                                        └─ master ノードが 1 回だけ
```

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
  readonly frequency: number
  readonly durationSecs: number
  readonly gain: number     // master は含まない
  readonly pan: number
  readonly loop: boolean
}
export type ToneHandle = { readonly id: number }

export type AudioBackend = {
  readonly availability: Effect.Effect<AudioAvailability>
  readonly playTone: (request: ToneRequest) => Effect.Effect<ToneHandle>
  readonly stopTone: (handle: ToneHandle) => Effect.Effect<void>
  readonly setMasterGain: (gain: number) => Effect.Effect<void>
}

export class AudioBackendPort extends Context.Tag('@nerima-games/mc-audio/AudioBackendPort')<...>() {}

export const makeRecordingBackend: (availability: AudioAvailability) => Effect.Effect<RecordedBackend>
export const UnavailableBackendLayer: Layer.Layer<AudioBackendPort>
```

`domain/backend-port.ts`。

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

**ユーザジェスチャによるアンロック機構、`unlocked` フラグ、保留キュー、
`webkitAudioContext` フォールバックはリポジトリ全体に存在しない**
（`webkitAudioContext|autoplay|userGesture|unlock` の grep が 0 件）。

`locked` という状態に名前を付けることで、字幕が `gate-blocked` と自己申告でき、
UI が「クリックして音を有効化」と出せるようになる。

### ハンドル id の罠

参照実装は `playTone` の id を**コンテキストゲートより前**に採番していた
（`audio-engine.ts:40` で採番、`:42` でゲート）。
つまりオーディオが無くても id は単調に増える。

**「ハンドルが返ってきた＝音が鳴った」と判断してはならない。**
判断材料は `availability` である。mc-audio の `UnavailableBackendLayer` も
同じくハンドルを返すので、この罠は残っている（意図的に、参照実装と同じ形にしてある）。

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

`domain/caption.ts`。

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
  readonly listener: Vec3
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

`domain/engine.ts`。

**決定を純関数 `planCue` に分離してある**ので、
「caption は無条件に計算され、tone だけがゲートで潰される」ことが
コードを読むだけで確認できる。

参照実装にも純粋なプランナはあったが（`sound-manager-playback.ts:11-18`）、
**字幕はその外側**にあった。だから両者の関係は文の順序だけで表現されていた。

### `nowSecs` が引数である理由

mc-kernel がまだ publish されていないため、`ClockPort` を import できない
（plan.md §6 Step 0）。kernel が消費可能になったら
`ClockPort.monotonicSecs` に置き換わり、この引数は消える。

monotonic 秒であること。壁時計でも `performance.now()` でもない
（`performance.now()` は `pnpm check:deps` が禁止している）。

---

## 6. BGM 状態機械

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

`domain/music.ts`。参照実装の構造をそのまま移植した
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

---

<a id="webaudio"></a>
## 7. 未実装: WebAudio アダプタ

`lib: ["DOM"]` が必要になるため、スケルトンには入れていない。

### 実装時に移植すべき内容

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

### 新規に作らなければならないもの

参照実装に**存在しない**ため、移植ではなく設計が必要:

1. **ユーザジェスチャによるアンロック** — `locked` → `ready` への遷移
2. **`webkitAudioContext` フォールバック** — 古い Safari
3. **保留キュー**（作るなら） — アンロック後に鳴らし直すか、捨てるか
4. **サンプル再生** — 参照実装は全てオシレータ合成。バッファのロード機構が無い

### 時刻の扱い

WebAudio のスケジューリングは `AudioContext.currentTime` を使う
（`audio-engine.ts:104`）。これは壁時計ではないので `Date.now()` 禁止に抵触しない。

もし `performance.now()` が必要になったら、その行に
`mc-kernel-allow-time-source` コメントを付けて逃がすこと
（`scripts/check-dependency-whitelist.ts` の `TIME_SOURCE_ESCAPE_HATCH`）。

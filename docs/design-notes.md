# 設計注意

plan.md §3.6 の 設計注意 を、参照実装の実コード (file:line) で裏取りして展開したもの。
plan.md §6 Step 2 の方針に従い、**各項目を「書くべき回帰テストの名前」として提示する**。

`✅` = このスケルトンに実装済み / `⬜` = 未実装（実装時に必ず入れる）

---

<a id="dn-1"></a>
## DN-1 ✅ 字幕はオーディオゲートより**前**に発火する

> plan.md §3.6:
> 「字幕イベントはオーディオゲート（ブラウザの自動再生制限）より**前**に発火する
> （参照実装の確定挙動: 音が出せない状態でも字幕は出る）。`AudioContext` はガード付きで生成」

**この記述は正しい。裏取り済みで、しかも参照実装のソースに理由まで書いてある。**

### 証拠

`packages/game/application/sound-manager.ts:43-63`:

```typescript
Effect.gen(function* () {
  // Captions fire BEFORE the audio-enabled gate on purpose: they exist
  // for players who play muted or can't hear — gating them on audio
  // being on would hide them from exactly the users they serve. The
  // caption HUD itself is opt-in via the audioCaptionsEnabled setting.
  yield* captions.announce(effect)            // ← 48 行目
  const enabled = yield* Ref.get(enabledRef)  // ← 49 行目
  ...
  const request = Option.getOrNull(toneRequest)
  if (request === null) {
    return                                     // ← 62 行目、早期 return
  }
```

参照実装のテスト（`packages/game/test/sound-manager.test.ts:230-241`）:

```typescript
it.effect('announces captions even while audio is disabled (hearing accessibility)', () => {
  ...
  yield* soundManager.applySettings({ enabled: false, masterVolume: 1, sfxVolume: 1 })
  yield* soundManager.playEffect('playerHurt')
  yield* soundManager.playEffect('thunderClap')
  expect(fake.playRequests).toHaveLength(0)
  expect(announced).toEqual(['playerHurt', 'thunderClap'])
})
```

### ただしゲートは 3 つあり、参照実装は 1 つしかテストしていない

字幕発火（`sound-manager.ts:48`）より**後**にあるゲートは 3 つある:

| # | ゲート | 場所 | 参照実装のテスト |
| --- | --- | --- | --- |
| 1 | 設定（`audioEnabled`） | `sound-manager-playback.ts:19-21` → `sound-manager.ts:62` の早期 return | ✅ あり |
| 2 | `AudioContext` が存在しない | `audio-engine.ts:42-44` | ❌ **無い** |
| 3 | 自動再生ポリシー（`resume()` 拒否） | `audio-engine.ts:46-49` | ❌ **無い** |

`packages/game/infrastructure/audio-engine.ts` と `audio-context-helpers.ts` には
**テストが 1 本も無い**。リポジトリ内のどのテストも `AudioContext` を構築しないし、
コンテキスト不在パスも `resume()` パスも一度も実行されていない。

つまり不変条件は `audioEnabled: false` については保証されており、
**自動再生をブロックするブラウザについては「たぶん正しい」でしかなかった。**
そしてそれは、初回訪問の全プレイヤー（まだ何もクリックしていない状態）が該当するケースである。

### mc-audio での対応

ゲートを 3 状態の値にした（`AudioAvailability`）ので、3 つとも同じ形でテストできる。
字幕には `reason` を持たせ、どのゲートで止まったかを字幕自身が申告する。

### 書くべき回帰テスト

| テスト名 | 主張 |
| --- | --- |
| ✅ `gate 1 — the player muted audio: caption yes, sound no` | `reason === 'muted'` |
| ✅ `gate 2 — the browser autoplay policy has not been satisfied: caption yes, sound no` | `reason === 'gate-blocked'`。**参照実装に無かったテスト** |
| ✅ `gate 3 — no audio backend exists at all: caption yes, sound no` | `reason === 'unavailable'`。**同上** |
| ✅ `when everything is available, the caption fires AND the sound plays` | `reason === 'audible'` |
| ✅ `an uncaptioned cue stays uncaptioned — a null caption is authorial, not a gate` | 2 種類の「無音」を混同しない |
| ✅ `planCue suppresses the tone but never the caption, for every non-ready state` | 純関数レベルでも同じ |
| ⬜ `the WebAudio adapter reports 'locked' before a user gesture and 'ready' after` | アダプタ実装時 |

実装は `test/caption-gate.test.ts`。
**このリポジトリで最も重要なテストファイル**であり、
`makeSoundCueService`（effect パイプライン）に対して書いてある。
純関数 `planCue` だけをテストすると、字幕発火をゲートの下に移動されても気付けない。

---

<a id="dn-2"></a>
## DN-2 ✅ master 音量はちょうど 1 回だけ適用する

plan.md には無いが、参照実装が 2 ファイルで警告している項目である。

### 証拠

`packages/game/application/music-manager-runtime.ts:68-71`:

```typescript
// masterVolume is applied ONCE by the engine's master gain node (see
// setMasterGain in applySettings); multiplying here too would square it.
const musicVolume = yield* Ref.get(musicVolumeRef)
const gain = clamp01(track.baseGain * musicVolume)
```

同旨のコメントが `packages/game/application/sound-manager.ts:65-69` にもあり、
assertion が `packages/game/test/sound-manager.test.ts:54-57` にある。

**同じ警告が 2 箇所に書かれ、テストまである**ということは、
誰かが一度この間違いをしたということである。

master `0.5` が `0.25` に聞こえるバグは、エラーにならず、
「なんか音が小さい」という報告としてしか現れない。

### 書くべき回帰テスト

| テスト名 | 主張 |
| --- | --- |
| ✅ `sfx gain does not change when master changes` | per-cue gain に master が入っていない |
| ✅ `sfx gain DOES change when the sfx category changes` | 上が「常に定数」で通ってしまうのを防ぐ |
| ✅ `music gain does not change when master changes` | 音楽側も同じ |
| ✅ `masterNodeGain is the only place master turns into a number` | master が数値化される場所が 1 つ |

実装は `test/volume.test.ts`。

---

<a id="dn-3"></a>
## DN-3 ✅ 「字幕イベントストリーム」は参照実装に存在しない

> plan.md §3.6: `CaptionEventStream`（UI が購読）

### 参照実装にあるのはストリームではない

`packages/game/application/sound-caption-port.ts:8-15`:

```typescript
export type SoundCaptionPortShape = {
  readonly announce: (effect: SoundEffect) => Effect.Effect<void, never>
}
export class SoundCaptionPort extends Context.Tag('@minecraft/audio/SoundCaptionPort')<...>() {}
```

- イベントの中身は**素のキュー ID**。タイムスタンプも位置も音量も無い
- `Stream` も `PubSub` もオーディオ層のどこにも無い
- 購読ではなく投げっぱなしのシンク

### 結果として起きたこと

字幕消費に必要なロジックが全部 DOM に落ちた
（`packages/presentation/hud/sound-captions.ts`）:

- `let captionsEnabled = false`（`:33`）— モジュールレベルの mutable
- `const activeRows = new Map<string, CaptionRow>()`（`:34`）— **ラベル**をキーにした mutable
- `CAPTION_DISPLAY_MS = 2500` / `MAX_CAPTION_ROWS = 5`（`:6-7`）
- 重複キューはタイマーをリフレッシュ（`:66-70`）、上限で最古を追い出す（`:72-76`）
- 生の `setTimeout` / `clearTimeout`（`:31`, `:68`, `:82`）

テストは `setSoundCaptionsEnabled(false)` でグローバル状態をリセットしていた
（`packages/presentation/test/sound-captions.test.ts:47`）。

DOM 無しの consumer（字幕エクスポータ、スクリーンリーダーブリッジ、
決定論リプレイの検証）は 1 行も再利用できない。

### mc-audio での対応

`CaptionEvent` に `atSecs`（monotonic）を持たせた。
これだけで期限切れと重複排除が**イベント列の純関数**になる:

```typescript
export const visibleCaptions: (events: ReadonlyArray<CaptionEvent>, nowSecs: number)
  => ReadonlyArray<CaptionEvent>
```

DOM 側は描画だけをする。fake timer が要らない。

重複排除は**字幕テキスト**で行う（キュー ID ではない）。
`footstepGrass` と `footstepStone` はどちらも "Footsteps" であり、
同じ行を 2 つ出しても情報が増えない。
参照実装がラベルをキーにしていたのと同じ判断である（`sound-captions.ts:34`）。

### 書くべき回帰テスト

| テスト名 | 主張 |
| --- | --- |
| ✅ `drops captions older than the display window` | 2.5 秒で消える |
| ✅ `keeps a caption right up to, but not including, the expiry instant` | 境界 |
| ✅ `refreshes a repeated caption instead of stacking a duplicate row` | 積み上がらない |
| ✅ `deduplicates by text, so two footstep cues share one row` | テキストキー |
| ✅ `caps the list, keeping the most recent` | 5 行上限 |
| ✅ `ignores an event stamped in the future rather than showing it early` | クロックスキュー耐性 |

実装は `test/music-and-captions.test.ts`。全て DOM 無し・fake timer 無しで走る。

### 移植時に決めること

DOM 側の accessibility 資産は mx-ui に引き継ぐ（plan.md §3.13）:

- `index.html:469` — `<div id="sound-captions" role="log" aria-live="polite" aria-label="Sound captions">`
- `index.html:130-149` — 字幕の CSS
- `audioCaptionsEnabled` 設定（既定 `false`、`settings.schema.ts:65`）

---

<a id="dn-4"></a>
## DN-4 ✅ 洞窟判定の比較は厳密な `<`

参照実装（`packages/game/application/music-manager-environment.ts:10-15`）:

```typescript
export const resolveMusicEnvironment = (context: MusicEnvironmentContext): MusicEnvironment => {
  if (context.playerPosition.y < context.caveThresholdY) return 'cave'
  return context.isNight ? 'night' : 'day'
}
```

`<=` ではなく `<` である。参照実装には境界専用のテストがある
（`packages/game/test/music-manager-environment.test.ts` —
「exactly at caveThresholdY (below = `<`, not `<=`)」）。

境界を含めてしまうと、y = 40 の 1 ブロック段差を歩いて往復するたびに
BGM が切り替わる。エラーは出ない。ただ気持ち悪い。

### 書くべき回帰テスト

| テスト名 | 主張 |
| --- | --- |
| ✅ `treats exactly-at-threshold as surface, not cave` | `<` である |
| ✅ `cave wins over day and night` | 優先順位 |
| ✅ `honours a caller-supplied threshold` | 閾値は注入可能 |

---

<a id="dn-5"></a>
## DN-5 ✅ 同じ環境が既に鳴っていたら何もしない

参照実装（`packages/game/application/music-manager-state.ts:31-37`）は
`active === desired` のとき `{ stop: false, play: none }` を返す。

これが無いと、毎フレーム「day から day に変わった」と判定して
トラックを再起動し続ける。エラーにはならず、
延々とリトリガーされる音として現れる。

### 書くべき回帰テスト

| テスト名 | 主張 |
| --- | --- |
| ✅ `does nothing at all when the desired track is already playing` | 再起動しない |
| ✅ `stops the old track and starts the new one on a change` | 変化時は stop → play |
| ✅ `stops the active track when music is turned off mid-track` | 途中で OFF にしたら止まる |
| ✅ `asks for nothing when disabled with nothing playing` | 4 通りを網羅 |
| ✅ `starts a track when nothing is playing` | 同上 |

---

<a id="dn-6"></a>
## DN-6 ⬜ `AudioContext` はガード付きで生成する

> plan.md §3.6:「`AudioContext` はガード付きで生成」

参照実装（`packages/game/infrastructure/audio-context-helpers.ts:3-24`）は
feature detection (`typeof AudioContext === 'undefined'`) + `Effect.try` +
`catchAllCause` で、**決して失敗しない** `Effect<Option<AudioContext>, never>` を返す。
この形はそのまま移植する。

生成は遅延で、最初の `playTone` 時である（`audio-engine.ts:22-36`）。
Layer 構築時ではない。

### 書くべき回帰テスト（アダプタ実装時）

| テスト名 | 主張 |
| --- | --- |
| ⬜ `acquiring an AudioContext in an environment without one yields 'unavailable', not a failure` | Node/SSR で落ちない |
| ⬜ `a context that throws on construction yields 'unavailable', not a defect` | try/catch |
| ⬜ `the context is created lazily, at the first cue, not at layer construction` | 起動時に権限を要求しない |
| ⬜ `captions still fire when the context is unavailable` | DN-1 のゲート 3 を実アダプタで |

**参照実装にはこの 4 つとも存在しない。**

---

## DN-7 ✅ オーディオ層は時計を読まない

参照実装のオーディオ 26 ファイルを `Date.now()` / `performance.now()` で
grep した結果は **0 件**である。

時間依存は以下に限られる:

- `audio-engine.ts:104` — `oscillator.stop(context.currentTime + ...)`（WebAudio クロック）
- `sound-captions.ts:31,68,82` — 字幕期限の `setTimeout`（DOM 側）
- ケイデンスは累積 `deltaTime`（`weather-sound.ts:19-33`、`footstep-sound-logic.ts:78-80`）

mc-audio もこの性質を保つ。`nowSecs` は注入する。

| テスト名 | 主張 |
| --- | --- |
| ✅ `flags Date.now(), new Date() and performance.now()` | ゲートが動く |
| ✅ `exempts a line carrying the escape-hatch marker` | WebAudio アダプタ用の逃げ道 |

実装は `test/dependency-policy.test.ts`。

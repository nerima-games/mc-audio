# 責務

出典: plan.md §3.6。参照実装の実コードで補正した箇所には根拠を付けてある。

## 1. 責務（plan.md §3.6 原文）

> WebAudio エンジン・効果音キューレジストリ・音楽コンテキスト（BGM 状態機械）・
> 字幕イベント発行。音声ファイル同梱

### 具体的に持つもの

| 要素 | 説明 | 状態 |
| --- | --- | --- |
| サウンドキューレジストリ | キュー ID のリテラル型 + 定義テーブル | ✅ |
| 音量カテゴリ | master / sfx / music、および gain 算術 | ✅ |
| 空間化 | 距離減衰とパン | ✅ |
| 字幕イベントストリーム | `CaptionEvent` の発行、可視リストの純粋計算 | ✅ |
| BGM 状態機械 | day / night / cave の遷移計画（純関数） | ✅ |
| オーディオゲート | `unavailable` / `locked` / `ready` の 3 状態 | ✅ |
| `AudioBackendPort` | WebAudio を封じ込める唯一の継ぎ目 | ✅ |
| WebAudio アダプタ | `AudioContext` のガード付き生成、オシレータ | ✅ `domain/webaudio-adapter.ts` |
| WebAudio 界面型 | `lib` に `"DOM"` を入れずに済ませる構造的サブセット | ✅ `domain/webaudio-surface.ts` |
| gain エンベロープ | クリック除去のための attack / release | ✅ `domain/envelope.ts` |
| 音声ファイル同梱 | plan.md §5.3 は音声を**この repository に**同梱と決めている。行は実在するが、**エンジニアが着手して終わる種類の行ではない**（下記 §5-1） | ⬜ 入力が無い |
| サウンドボードプレビュー | 全キューを一覧から試聴 | ✅ `apps/preview-soundboard/` |

### WebAudio アダプタについて

**`tsconfig.base.json` の `lib` は `["ES2024"]` のままである。`"DOM"` は入れていない。**

`domain/webaudio-surface.ts` が、アダプタが実際に使う Web Audio のメンバだけを
構造的に記述し、`test/webaudio-surface.test.ts` が
`test/fixtures/webaudio-surface.ts` を**本物の `lib.dom.d.ts` に対してコンパイル**して
「実 `AudioContext` がキャスト無しでこの型を満たす」ことを証明している。
mc-save（`domain/indexeddb-surface.ts`）、mc-render、mx-ui と同じ手法である。

理由は `docs/architecture.md` §3 が書いていたとおり:
`"DOM"` を入れると `domain/` の全ファイルが `window` / `document` / `localStorage` に
手を伸ばせるようになり、**何ヶ月も誰も気付かない**。
`pnpm typecheck` が「この toolkit はプラットフォーム非依存である」という
**証明**であり続けるために入れていない。

この方式が 1 つだけ通らなかった箇所（`AudioNode.connect`）と、
コンパイラが見つけた 4 つ目の `AudioContextState`（`'interrupted'`、iOS の着信）は
`domain/webaudio-surface.ts` のヘッダに記録してある。

### プレビューについて

`apps/preview-soundboard/`。ターミナルアプリなので**音は鳴らない**。
何が確認でき、何が確認できないかは
[apps/preview-soundboard/README.md](../apps/preview-soundboard/README.md) に書いてある。
本物の `makeSoundCueService` を本物のアダプタの上で走らせ、その結果を読み出して表示する
（再計算はしない）。

## 2. 非スコープ（ここに書いたら負け）

| 非スコープ | 正しい置き場 | 理由 |
| --- | --- | --- |
| 「ブロックを壊したら音を鳴らす」ルール | **mx-gameplay** | 動詞は体験モジュール（plan.md §2.3-1） |
| プレイヤー座標の取得 | **呼び出し側が渡す** | mc-audio は sim を import しない。これが DOM 無しでテストできる理由 |
| 「今が夜か」の判定 | **mc-sim**（`TimeService`） | mc-audio は `isNight: boolean` を受け取るだけ |
| 字幕の DOM 描画 | **mx-ui** | DOM は mx-ui の専管 |
| 音量スライダーの UI | **mx-ui** | 同上 |
| 設定の永続化 | **mc-save** のツールキットで、設定を所有するリポジトリが定義 | |
| 足音の発火間隔 | **mx-gameplay** | 参照実装も距離ベースの間隔判定を frame stage 側に置いていた（`physics-stage-survival/footstep-sound-logic.ts`） |
| 天候音のケイデンス | **mx-gameplay** | 同上（`weather-sound.ts:19-33`） |

### 特に注意: mc-audio は「シンク」である

押し込まれる側であり、押し返さない。
`mc-sim` を import して「プレイヤーはどこ？」と聞いた瞬間に、
- 依存の向きが逆転し、
- DOM 無しでのテストが不可能になり、
- 依存ホワイトリスト CI が落ちる。

## 3. plan.md §3.6 の記述と実態の差

### 3-1. `SoundCuePort` — ほぼ一致

> plan.md: `SoundCuePort`（`play(cueId, options)`）

参照実装の実シグネチャ（`packages/game/application/sound-manager.ts:36-42`）:

```typescript
playEffect: (
  effect: SoundEffect,
  options?: { readonly position?: Position; readonly gainScale?: number },
) => Effect.Effect<void, never>
```

名前が `playEffect` である以外は plan.md どおり。mc-audio では `play` にした。

### 3-2. `MusicContextPort` — 実態は `MusicManagerRuntime`

参照実装のタグは `@minecraft/audio/MusicManager`
（`packages/game/application/music-manager.ts:11-12`）で、
`applySettings` / `setEnvironment` / `updateFromContext` / `stop` /
`getCurrentEnvironment` / `getState` の 6 メソッドを持つ。

### 3-3. `CaptionEventStream` — **存在しない**

plan.md は「UI が購読する」ストリームを要求しているが、参照実装にあるのは
単一メソッドの投げっぱなしシンクである。→ [design-notes.md](./design-notes.md#dn-3)

### 3-4. 音量カテゴリ — 一致、ただし enable は 1 つだけ

`masterVolume` / `sfxVolume` / `musicVolume` の 3 つは plan.md どおり。

ただし `audioEnabled` は **sfx と music で共有された 1 個のフラグ**であり、
カテゴリごとの ON/OFF は無い
（`packages/app/application/frame/frame-settings-apply.ts:69` と `:76` が
どちらも `settings.audioEnabled` を渡している）。

`audioEnabled` の既定値は **`false`** である
（`packages/game/application/settings-service.ts:34`、
schema 側にも `:71-74` に「audioEnabled defaults to false intentionally」とコメントがある）。
つまり既定構成では字幕だけが出て音は鳴らない。
[design-notes.md](./design-notes.md#dn-1) の不変条件が既定で効いている状態である。

## 4. 親・子

### 親（mc-audio が依存してよいリポジトリ）

| リポジトリ | 何のために |
| --- | --- |
| `mc-kernel` | `SoundCuePort` / `CaptionEventStream` の**界面型**（plan.md §4.3）、Clock Port、`Position`。**唯一の依存** |

直接依存のホワイトリストは**空集合**である。

### 子（mc-audio に依存するリポジトリ）

| リポジトリ | mc-audio をどう使うか |
| --- | --- |
| `mx-gameplay` | 採掘・Mob・天候などのルールからキューを発火する |
| `mx-ui` | 字幕を購読して表示する。音量設定 UI を提供する |

## 5. アセットの扱い（plan.md §5.3）

> 独立アセットリポジトリは作らない。アセットは消費者に同梱（テクスチャ → render、**音声 → audio**）。
> リソースパック機能を作る時に再検討

音声ファイルは mc-audio に同梱する。**この行が他 repository のものである可能性は無い。**
plan.md §5.3 は行き先を名指ししており（「音声 → audio」）、消費者である mx-gameplay や
mx-ui に置けば、キューを持つ repository とキューの音を持つ repository が分かれることになる。

### 5-1. ⬜ の理由は「やっていない」でも「やれない（publish 待ち）」でもない

この行は §1 の他の ⬜ とも、mc-worldgen が publish 待ちで止めている行とも種類が違う。
**止めているのは依存でも設計判断でもなく、まだ誰も作っていない入力である。**

実測（`find` / `grep`、いずれも 2 リポジトリ全体）:

| 事実 | 実測値 |
| --- | --- |
| 参照実装の音声ファイル | **0 件**（`*.ogg` / `*.mp3` / `*.wav`） |
| 参照実装のサンプル再生機構 | **0 件**（`decodeAudioData` / `createBufferSource` / `AudioBuffer` の grep が空） |
| 本リポジトリの音声ファイル | **0 件** |
| 本リポジトリのサンプル再生機構 | **0 件**。`domain/webaudio-surface.ts:152-155` が「`AudioBufferSourceNode` は別ノードで別の追加」と明記している |

参照実装は**全てオシレータ合成**である。つまりこの行は移植ではなく新規であり、
しかも新規の部分は 2 つに分かれる:

1. **音源そのもの** — 選定・ライセンス確認・コミット。
   これは実装作業ではなく調達であり、**コードを書いても終わらない**。
2. **サンプル再生パス** — `AudioBufferSourceNode` を `webaudio-surface.ts` に足し、
   `AudioBackendPort` に再生系を通す。こちらは普通の実装で、1 の後にしか意味を持たない
   （鳴らすものが無いローダは、テストできる主張を 1 つも持たない）。

**プレースホルダ音源を合成して置くのは解決ではない。** 現状のオシレータ合成が既にそれであり、
ファイルにして置き直しても、鳴る音は同じで、レビューできない wav が repository に増えるだけである。

### 5-2. 参照実装の候補リストはここには無い

以前この節は `docs/resources/recommended-sound-assets.md` (203 行) を構想文書として挙げていた。
**そのパスは本リポジトリに存在しない。** ファイルがあるのは参照実装側の
`ts-minecraft/docs/resources/recommended-sound-assets.md` であり、
中身は Freesound / Pixabay / OpenGameArt の **URL とライセンス表記のキュレーション**である。
「ライセンス: 要確認」と書かれた行を含み、**1 ファイルも取得・確認・コミットされていない。**

つまりあちらにあるのも音源ではなく買い物リストである。
この行を動かす最初の一歩は、そのリストのライセンスを実際に確認して
CC0 の音を数個コミットすることであって、コードではない。

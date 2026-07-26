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
| WebAudio アダプタ | `AudioContext` のガード付き生成、オシレータ | ⬜ **未実装** |
| 音声ファイル同梱 | アセットは消費者に同梱（plan.md §5.3） | ⬜ |
| サウンドボードプレビュー | 全キューを一覧から試聴 | ⬜ |

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

音声ファイルは mc-audio に同梱する。

**ただし参照実装には音声ファイルが 1 つも無い。** 全てオシレータ合成であり、
バッファ／サンプルのロード機構もアセットパイプラインも存在しない。
`docs/resources/recommended-sound-assets.md` (203 行) は構想文書である。

つまりサンプル再生は**新規実装**であり、移植ではない。

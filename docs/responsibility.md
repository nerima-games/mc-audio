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
| 音声サンプルと manifest | バイナリを固定せず、決定的な標準 WAV manifest、URL / `ArrayBuffer` manifest、Minecraft sound registry をこの repository で管理 | ✅ |
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
| `mc-kernel` | 共有語彙の `ClockPort` と `Position`。音声固有の `SoundCuePort` / `CaptionStream` はこの repository が所有する。**唯一の直接依存** |

直接依存のホワイトリストは `@nerima-games/mc-kernel` を許可している。

### 子（mc-audio に依存するリポジトリ）

| リポジトリ | mc-audio をどう使うか |
| --- | --- |
| `mx-gameplay` | 採掘・Mob・天候などのルールからキューを発火する |
| `mx-ui` | 字幕を購読して表示する。音量設定 UI を提供する |

## 5. アセットの扱い（plan.md §5.3）

> 独立アセットリポジトリは作らない。アセットは消費者に同梱（テクスチャ → render、**音声 → audio**）。
> リソースパック機能を作る時に再検討

音声の解決・再生に必要なデータ形式は mc-audio が所有する。バイナリ音源を無断で固定せず、
`createOriginalSampleManifest()` が決定的な短い WAV を生成し、`AudioSampleManifest` は URL または
独自 `ArrayBuffer` も受け入れる。`sounds.json` の解析・replace マージ・weight バリアント・
subtitle・attenuation・manifest 変換も `minecraft-sounds*` に集約している。

### 5-1. 現在の境界

- バイナリの Minecraft 音源ファイルは、ライセンスと配布元が未確定のためコミットしていない。
- 代わりに標準サンプルは実行時生成し、決定性をテストしている。
- 実音源を組み込む場合は、`AudioSampleManifest` に URL または `ArrayBuffer` を渡すだけで、
  再生・decode・cache・失敗時の tone fallback は既存の WebAudio アダプタを使える。
- 外部 resource pack の取得、HTTP streaming、マイク録音は音源 registry / playback と別の機能であり、
  このパッケージの現在のスコープには含めていない。

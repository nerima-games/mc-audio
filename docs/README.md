# mc-audio ドキュメント

`@nerima-games/mc-audio` を実装するために必要な情報をここに集約している。
**plan.md を読み直さなくても実装できる**ことを目標に書いてある。

## 読む順序

| ファイル | 内容 |
| --- | --- |
| [architecture.md](./architecture.md) | 4 階層アーキテクチャ、16 リポジトリ依存グラフ、mc-audio の位置 |
| [responsibility.md](./responsibility.md) | 責務と**非スコープ**、親・子リポジトリ |
| [public-api.md](./public-api.md) | 公開すべき API。参照実装の実コードで検証済み |
| [design-notes.md](./design-notes.md) | 設計注意。参照実装の証拠 (file:line) 付き、回帰テスト名として提示 |
| [porting.md](./porting.md) | 移植元パスと**実測 LOC** |
| [testing.md](./testing.md) | 検証要件・完了条件・カバレッジゲートの扱い |
| [versioning.md](./versioning.md) | 0.x → 1.0.0 の方針、GitHub Packages、publish の開始時期 |

## 最初に知っておくべき 3 点

### 1. 字幕はオーディオゲートより**前**に発火する

音が出せない状態でも字幕は出る。これが mc-audio の存在理由であり、
最も壊してはいけない不変条件である。

参照実装で確定した挙動であり、ソースにその旨のコメントが残っている
（`packages/game/application/sound-manager.ts:43-48`）。

ただし参照実装は**3 つあるゲートのうち 1 つしかテストしていなかった**。
mc-audio は 3 つとも固定する。詳細は [design-notes.md](./design-notes.md#dn-1)。

### 2. master 音量は「ちょうど 1 回だけ」適用する

per-cue の gain 計算に master を掛けてはならない。掛けると二乗になる。
参照実装は同じ警告を 2 ファイルに書き、assertion で固定していた。
詳細は [design-notes.md](./design-notes.md#dn-2)。

### 3. 「字幕イベントストリーム」は参照実装に存在しない

plan.md §3.6 は `CaptionEventStream` を要求しているが、
参照実装の `SoundCaptionPort` は単一メソッドの投げっぱなしシンクであり、
`Stream` も `PubSub` も無い。重複排除・上限・期限切れは全部 DOM コードの中にあった。
詳細は [design-notes.md](./design-notes.md#dn-3)。

## 現在の状態

叩き台 (pre-audit first cut)。`pnpm verify` は green。
WebAudio アダプタとサウンドボードプレビューは未実装
（[testing.md](./testing.md)、[versioning.md](./versioning.md)）。

# mc-audio ドキュメント

`@nerima-games/mc-audio` を実装するために必要な情報をここに集約している。
**plan.md を読み直さなくても実装できる**ことを目標に書いてある。

## 表記

| 表記 | 意味 |
| --- | --- |
| `<reference-impl>` | **参照実装のチェックアウトのルート**。凍結された `takeokunn/ts-minecraft` の作業コピーを指す。本ドキュメント群では `<reference-impl>/packages/…` の形か、単に `packages/…`（同じくルート相対）で引用する。手元のどこに clone してあっても読み替えられるようにするためのプレースホルダである |
| plan.md | リポジトリ構成仕様書（16 リポジトリ、確定済み）。**非公開**であり、公開読者は開けない。だから本ドキュメント群は「plan.md を読まなくても追える」ことを要件にしている —— plan.md の主張を引くときは必ず原文を引用し、参照実装での裏づけを file:line で添える |
| `nerima-games/<repo>` | 同 org の兄弟リポジトリ。リンクは GitHub の URL で張る |

## 読む順序

| ファイル | 内容 |
| --- | --- |
| [architecture.md](./architecture.md) | 4 階層アーキテクチャ、16 リポジトリ依存グラフ、mc-audio の位置 |
| [responsibility.md](./responsibility.md) | 責務と**非スコープ**、親・子リポジトリ |
| [public-api.md](./public-api.md) | 公開すべき API。参照実装の実コードで検証済み |
| [minecraft-sounds.md](./minecraft-sounds.md) | `sounds.json`、BGM、ambient_sounds のデータ駆動音声 |
| [free-music.md](./free-music.md) | フリー音源、Minecraft 互換の BGM 定義、差し替え方法 |
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

現行実装。`pnpm verify` は typecheck、lint、依存境界、全テスト、全指標 100% のカバレッジ、出荷ビルドを検証する。
全テストとカバレッジは CI のゲートで検証し、カバレッジは全 4 指標 100% を要求する。

WebAudio アダプタ（`domain/webaudio-adapter.ts`）とサウンドボードプレビュー
（`apps/preview-soundboard/`）は**実装済み**。
`tsconfig.base.json` の `lib` は `["ES2024"]` のままで、`"DOM"` は入れていない
—— 理由と手法は `domain/webaudio-surface.ts` のヘッダに書いてある。

著作権付き音声バイナリは同梱せず、`sounds.json` から URL / `ArrayBuffer` の
`AudioSampleManifest` を受け取る。実ブラウザでの契約確認は Node の fake backend
とは別であり、何が確認できて何ができないかは
[apps/preview-soundboard/README.md](../apps/preview-soundboard/README.md) に記載する。

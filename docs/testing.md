# テストと完了条件

## 1. コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）、`tsconfig.test.json`（テスト+ツール）、`tsconfig.preview.json`（プレビュー）の 3 つ |
| `pnpm lint` | oxlint。このリポジトリ唯一の lint/format 設定（prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`.oxlintrc.json` は 5 カテゴリすべてと個別 40 ルールが `warn`、`error` は 2 つだけ。このフラグが無かった頃は実質その 2 つしかゲートになっていなかった） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API） |
| `pnpm preview` | サウンドボードプレビュー。**ゲートではない**（`pnpm verify` は実行しない） |
| `pnpm test:coverage` | カバレッジ計測。**閾値は未設定**（後述） |
| `pnpm verify` | 上記 4 つ（coverage 以外）。CI と同一内容 |

`pnpm` は PATH に無い場合がある。`corepack pnpm <cmd>` で 9.15.0 が起動する。

## 2. 現状のテスト

```
test/caption-gate.test.ts          8 tests   字幕→ゲートの順序（3 ゲート全部）
test/volume.test.ts               16 tests   master 一回適用、gain 算術、空間化
test/music-and-captions.test.ts   18 tests   BGM 遷移、字幕の可視リスト、キューロスター
test/dependency-policy.test.ts    19 tests   16 リポジトリのグラフ、import ゲート、時計禁止
test/api-lock.test.ts             26 tests   公開 API スナップショットの生成と判定
test/webaudio-surface.test.ts      3 tests   構造的サブセットの証明（本物の lib.dom に対するコンパイル）
test/envelope.test.ts             13 tests   エンベロープの算術（クリック除去）
test/webaudio-adapter.test.ts     31 tests   ガード、アンロック、グラフ、master ノード
test/soundboard-preview.test.ts   24 tests   プレビューの純粋部分（フレームの主張）
                                  ─────
                                 158 tests   全て green
```

（このリストの以前の版は 61 と書いていたが、`test/api-lock.test.ts` の 26 を
数え落としていた。WebAudio アダプタ着手前の実数は **87** である。）

### 「lib に DOM を入れずに WebAudio を出荷する」ことの検証

`test/webaudio-surface.test.ts` が**表裏 2 つ**の主張を固定している。
片方だけでは意味が無い。

| 主張 | 何を防ぐか |
| --- | --- |
| `test/fixtures/webaudio-surface.ts` を**本物の `lib.dom.d.ts`** に対してコンパイルして診断 0 | `domain/webaudio-surface.ts` が実在しない API を記述しても誰も気付かない、を防ぐ |
| `tsconfig.build.json` が今も `lib: ["ES2024"]` / `types: []` で、**アダプタがその中に居る** | 誰かが `"DOM"` を足して界面型を消す、を防ぐ |

fixture は `tsconfig.json` / `tsconfig.test.json` / `tsconfig.preview.json` から
**除外**されている（DOM 型を名指しするため）。除外されていることも上のテストが固定する。

この仕組みは既に 2 回仕事をしている。詳細は `domain/webaudio-surface.ts` のヘッダ:

1. `AudioContextState` に 4 つ目の値 `'interrupted'` があった（iOS の着信）。
   仕様書にもチュートリアルにも出てこない。**コンパイラだけが知っていた。**
   これを知らないアダプタは、着信中の iOS を `ready` と報告し、
   聞こえない音に `audible` の字幕を付ける —— DN-1 が防ごうとしている失敗そのものである
2. `AudioNode.connect` だけは反変プロパティとして書けない
   （書くと `AudioNode` 全体を記述する羽目になる）。メソッド構文にしてあり、
   その双変性が何を失っているかはヘッダに明記してある

### `test/caption-gate.test.ts` が最重要である

字幕がオーディオゲートより前に発火することを、**3 つのゲート全てについて**固定する。
参照実装は設定ゲートしかテストしていなかった
（[design-notes.md](./design-notes.md#dn-1)）。

このテストは純関数 `planCue` ではなく **`makeSoundCueService`（effect パイプライン）**
に対して書いてある。順序は effect パイプラインの性質であり、
純関数だけを見ていると「字幕発火をゲートの下に移す」変更に気付けない。

### DOM も fake timer も使っていない

**WebAudio アダプタが入った後も**、158 テスト全てが Node で走る。
jsdom も `AudioContext` も要らない。
`tsconfig.base.json` の `lib` に `"DOM"` を入れていないことの直接の効果である。

参照実装の字幕テスト（`packages/presentation/test/sound-captions.test.ts`, 133 LOC）は
DOM とタイマーを必要とし、テスト間でモジュールレベルのグローバル状態をリセットしていた。

## 3. plan.md §3.6 が要求する検証

> **検証**: キュー発火のユニットテスト（オーディオゲート・音量計算）+
> **サウンドボードプレビュー**（全キューを一覧から試聴）

| 要求 | 状態 |
| --- | --- |
| キュー発火のユニットテスト（オーディオゲート） | ✅ `test/caption-gate.test.ts` |
| キュー発火のユニットテスト（音量計算） | ✅ `test/volume.test.ts` |
| サウンドボードプレビュー | ✅ `apps/preview-soundboard/` |

### サウンドボードプレビューについて

plan.md §2.3-4:「プレビューは検証対象と同居する」。
`apps/preview-soundboard/` に置く（plan.md §4.1 の配置規約）。

**mc-playground-kit は要らない。** DOM だけで起動できる（mx-ui と同じ理由）。
そもそも kit を使うと依存グラフ上で問題になる。

プレビューで確認すべきこと（5 点とも実装済み。ただし 3 は「耳で」ではない — 後述）:

| # | 内容 | どこで | 固定しているテスト |
| --- | --- | --- | --- |
| 1 | 全キューを一覧表示し、選んで発火できる | `board` パネル | `locked audio: the caption is on screen...` |
| 2 | **ロック状態で字幕だけが出る**（DN-1 の目視版） | `board` + `graph` | 同上 / `the graph panel names where the guard stopped` |
| 3 | master / sfx / music が二乗になっていない | `mix` パネル | `per-cue gain does not move when master moves` |
| 4 | 空間化: 音源を動かしてパンと距離減衰 | `mix` パネル | `shows attenuation and pan changing as the source moves` |
| 5 | BGM が同じ環境で再起動しない | `music` パネル | `says NO ACTION when the desired track is already playing` |

**3 は「耳で確認」ではなく「数字で確認」である。** ターミナルなので音は鳴らない。
DN-2 の二乗は `0.5` が `0.25` に聞こえるだけでエラーにならない種類のバグなので、
`per-cue gain` と `master node gain` を別々の列に出して、
master スライダーを動かしたときに**左の列が動かない**ことを見る形にしてある。

プレビューが**確認できないこと**（クリックが実際に消えたか、
9 キューが互いに区別できるか、ブラウザが実際に何をするか）は
[apps/preview-soundboard/README.md](../apps/preview-soundboard/README.md) §2 に
列挙してある。プレビューは検証したように見せてはならない。

## 4. 完了条件

このリポジトリが「完成」と言えるのは以下が全て満たされたときである。

1. `pnpm verify` が green
2. **WebAudio アダプタが実装され、`AudioBackendPort` の契約テストが実ブラウザで green**
   - アダプタは実装済み（`domain/webaudio-adapter.ts`）。DN-6 の 4 テストも
     `test/webaudio-adapter.test.ts` に入った
   - **残っているのは「実ブラウザで」の部分**。`test/fake-webaudio.ts` は
     拒否するかどうかを**教えられている**ので、
     「拒否されたときどう振る舞うか」は固定できても
     「このブラウザが拒否するか」は答えられない。ブラウザで確認すべきことは
     [apps/preview-soundboard/README.md](../apps/preview-soundboard/README.md) §2-4
3. **サウンドボードプレビューが操作可能**（上記 5 点を目視確認できる） ✅
4. キューロスターが確定している
   - 現在は代表 9 個の暫定。参照実装は 17 個
   - **最終ロスターは mx-gameplay のルールと一緒に決まる**（キューを鳴らすのは gameplay）
5. 音声アセットが同梱されている（plan.md §5.3: アセットは消費者に同梱）。
   **これは実装ではなく調達で止まっている行である** — 参照実装にも本リポジトリにも
   音声ファイルは 0 件、サンプル再生機構も 0 件。詳細と実測は
   [responsibility.md](./responsibility.md) §5-1
   - 参照実装は全てオシレータ合成で、音声ファイルが 1 つも無い。**新規作業**
6. カバレッジ 99% ゲートが有効化されている（後述）

## 5. カバレッジ閾値: 今はまだ設定しない

参照実装は branches / functions / lines / statements の 99% を強制している。
mc-audio でも**最終的には同じ 99% を課す**が、今は課さない。

理由: スケルトンに閾値を課しても意味が無い。
型定義だけのモジュールをいくつか置けば簡単に満たせてしまい、
実装の品質について何も語らない数字になる。

現状:

- 計測とレポートは**常に動いている**（`pnpm test:coverage`、CI でもアーティファクト化）
- 閾値だけが未設定。`vitest.config.ts` の `coverage.thresholds` がコメントアウトされている
- CI の `Coverage` ステップも同様

**有効化のタイミング**: 上記「完了条件」の 1〜5 を満たした時点で、
`vitest.config.ts` と `.github/workflows/ci.yaml` の**両方**を同時に更新する。

```typescript
thresholds: { branches: 99, functions: 99, lines: 99, statements: 99 },
```

## 6. テストの書き方の規約

### `@effect/vitest` の `it.effect` を使う

```typescript
it.effect('name', () => Effect.gen(function* () { ... }).pipe(Effect.provide(SomeLayer)))
```

副作用の無い純粋な assertion には `Effect.sync(() => { ... })` を使う
（`Effect.gen` で `yield*` しないと oxlint の `require-yield` が警告する）。

### 例外: DOM イベントフローのテスト

plan.md §3.13 が記録している既知の落とし穴:

> DOM イベントフローのテストで `Effect.fork` + `Deferred.await` を `it.effect` で書くとデッドロックする
> — プレーン `it` + `Effect.runPromise` を使う

WebAudio アダプタのテストとサウンドボードプレビューの E2E で該当しうる。

### 回帰テストには「なぜ」を書く

参照実装の挙動を固定するテストには、
**どのファイルの何行目を固定しているのか**をコメントに残すこと。
根拠を失ったテストは、次のリファクタで「よく分からないので消す」対象になる。

このリポジトリの既存テストは全てこの形式で書かれている。

### 「壊せるテスト」を書く

`test/caption-gate.test.ts` は 3 ゲートを**別々の availability で**走らせる。
1 つのゲートだけ見て「字幕が出た」と確認しても、
他のゲートで字幕が消えていることに気付けない。

参照実装が実際にそうなっていた。設定ゲートだけを見て安心し、
自動再生ゲートは 3 年間検証されないままだった。

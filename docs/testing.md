# テストと完了条件

## 1. コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）と `tsconfig.test.json`（テスト+ツール）の両方 |
| `pnpm lint` | oxlint。このリポジトリ唯一の lint/format 設定（prettier も biome も .editorconfig も置かない） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API） |
| `pnpm test:coverage` | カバレッジ計測。**閾値は未設定**（後述） |
| `pnpm verify` | 上記 4 つ（coverage 以外）。CI と同一内容 |

`pnpm` は PATH に無い場合がある。`corepack pnpm <cmd>` で 9.15.0 が起動する。

## 2. 現状のテスト

```
test/caption-gate.test.ts          8 tests   字幕→ゲートの順序（3 ゲート全部）
test/volume.test.ts               16 tests   master 一回適用、gain 算術、空間化
test/music-and-captions.test.ts   18 tests   BGM 遷移、字幕の可視リスト、キューロスター
test/dependency-policy.test.ts    19 tests   16 リポジトリのグラフ、import ゲート、時計禁止
                                  ─────
                                  61 tests   全て green
```

### `test/caption-gate.test.ts` が最重要である

字幕がオーディオゲートより前に発火することを、**3 つのゲート全てについて**固定する。
参照実装は設定ゲートしかテストしていなかった
（[design-notes.md](./design-notes.md#dn-1)）。

このテストは純関数 `planCue` ではなく **`makeSoundCueService`（effect パイプライン）**
に対して書いてある。順序は effect パイプラインの性質であり、
純関数だけを見ていると「字幕発火をゲートの下に移す」変更に気付けない。

### DOM も fake timer も使っていない

61 テスト全てが Node で走る。jsdom も `AudioContext` も要らない。
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
| サウンドボードプレビュー | ⬜ **未実装** |

### サウンドボードプレビューについて

plan.md §2.3-4:「プレビューは検証対象と同居する」。
`apps/preview-soundboard/` に置く（plan.md §4.1 の配置規約）。

**mc-playground-kit は要らない。** DOM だけで起動できる（mx-ui と同じ理由）。
そもそも kit を使うと依存グラフ上で問題になる。

プレビューで確認すべきこと:

1. 全キューを一覧表示し、クリックで試聴できる
2. **オーディオがロックされた状態（初回訪問、まだクリックしていない）で
   字幕だけが出ることを目視できる** — これが DN-1 の目視版
3. master / sfx / music のスライダーを動かして、二乗になっていないことを耳で確認できる
4. 空間化: 音源をドラッグして左右のパンと距離減衰を確認できる
5. BGM の day / night / cave を切り替えて、同じ環境で再起動しないことを確認できる

## 4. 完了条件

このリポジトリが「完成」と言えるのは以下が全て満たされたときである。

1. `pnpm verify` が green
2. **WebAudio アダプタが実装され、`AudioBackendPort` の契約テストが実ブラウザで green**
   - 特に `locked` → `ready` のユーザジェスチャアンロック
   - **参照実装にはこの機構が存在しない**（[design-notes.md](./design-notes.md#dn-6)）ので新規設計
3. **サウンドボードプレビューが操作可能**（上記 5 点を目視確認できる）
4. キューロスターが確定している
   - 現在は代表 9 個の暫定。参照実装は 17 個
   - **最終ロスターは mx-gameplay のルールと一緒に決まる**（キューを鳴らすのは gameplay）
5. 音声アセットが同梱されている（plan.md §5.3: アセットは消費者に同梱）
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

# バージョニングと公開

## 1. 現在: `0.2.6`、未公開

`package.json`:

```json
"version": "0.2.6",
"publishConfig": { "registry": "https://npm.pkg.github.com", "access": "restricted" }
```

`publishConfig` は書いてあるが、**publish はまだ一度も行っていない**。

## 2. なぜまだ公開しないのか

plan.md §6 Step 0 / §8 は元々「界面安定（4 週間 API ロック無変更）まで npm 公開・バージョン
bump 運用を開始しない」という日数計測ベースのゲートを想定していたが、この自動凍結ゲートと
その根拠だった `api-lock.md` は org 全体で廃止された
（[API_STANDARD.md §4](https://github.com/nerima-games/.github/blob/main/API_STANDARD.md#4-自動-apiロックスナップショットツールは使わない)）。
現在の方針は次の通り:

> npm 公開・バージョン bump、および 0.x → 1.0.0 への昇格は、日数計測などの自動ゲートを設けず
> **maintainer(take)による裁量判断のみ**で行う
> （[RELEASE_STANDARD.md §4.2](https://github.com/nerima-games/.github/blob/main/RELEASE_STANDARD.md#42-新しい昇格ポリシー人間による裁量判断)）。

リスク「新規構築初期は全界面が高 churn」への対策（npm 公開を遅らせ dev-meta workspace で開発し、
bump 連鎖を構造的に回避する)という判断自体は変わらない。

16 リポジトリが互いに依存している状態で早期に publish を始めると、
kernel の些細な変更が 15 リポジトリの version bump を誘発する。
開発初期は界面が動くのが当たり前なので、これは毎日起きる。

代わりに `mc-dev-meta` workspace で `workspace:*` 解決を使い、
モノレポと同等の DX で開発する。

### 現在の依存境界

実装は `effect` と `@nerima-games/mc-kernel` に依存する。mc-kernel からは
`Position` と `ClockPort` という共有語彙だけを直接利用し、オーディオ固有の
Port とデータ型はこのリポジトリで管理する。

- `@nerima-games/mc-kernel` は `package.json` と lockfile で明示的に固定する
- `minecraft-sound-player.ts` は kernel の `ClockPort` と `Position` を直接使う
- `scripts/check-dependency-whitelist.ts` が tier 1 の依存境界を検査する

意図された依存グラフは**ドキュメントと検査スクリプト**に記録してある:

- [DEPENDENCY_POLICY.md §1](https://github.com/nerima-games/.github/blob/main/DEPENDENCY_POLICY.md#1-4層の依存グラフエッジレベル)(16リポジトリ全部のエッジ一覧。実効機構は `.oxlintrc.json` の `no-restricted-imports`)
- [architecture.md](./architecture.md) の Mermaid 図

publish 開始時も、ボトムアップ（kernel → 各 tier1 → worldgen → …）で
**publish してから pin する**。現在の npm publish はまだ実行していない。

## 3. `0.x` の間の約束

| 項目 | 方針 |
| --- | --- |
| semver | `0.x` なので minor bump で破壊的変更が入りうる |
| 破壊的変更の扱い | CHANGELOG に必ず書く。黙って変えない |
| 消費者 | まだ居ない。居ないうちに界面を固める |

## 4. `1.0.0` にする条件

**下流リポジトリが実際に消費して契約を確認したとき**に `1.0.0` にする。

mc-audio の場合、具体的には:

1. `mx-gameplay` が実際にキューを発火している（採掘・Mob・天候）
2. `mx-ui` が実際に字幕を購読して表示し、音量 UI を提供している
3. 上記の消費・動作確認を踏まえ、maintainer が昇格を裁量判断する。日数計測などの
   自動ゲートは設けない([RELEASE_STANDARD.md §4.2](https://github.com/nerima-games/.github/blob/main/RELEASE_STANDARD.md#42-新しい昇格ポリシー人間による裁量判断))
4. WebAudio アダプタが実装済みで、`locked` → `ready` のアンロックが実ブラウザで動く
5. **キューロスターが確定している** — 現在の `cue.ts` は 17 個を定義している。
   ロスターは公開 API の一部であり、キューの追加は semver-minor だが、
   キューの**削除・改名**は破壊的変更になる

「良さそうだから 1.0 にする」はしない。
**実消費者が 2 つ付いて初めて、界面が正しいかどうかの証拠が揃う。**

## 5. ビルドと publish のパイプライン

### 現状: release build は実装済み、publish は未実行

`package.json`:

```json
"main": "./dist/index.js",
"types": "./dist/index.d.ts",
"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }
```

`pnpm build` は `tsconfig.release.json` から `dist/` に JavaScript、宣言、source map を生成する。
開発時の `tsconfig.base.json` は検査専用で `noEmit: true` のままである。

公開パッケージの consumer は `dist/` の条件付き export を読む。

### 現在の release build

1. `tsconfig.release.json` が `dist/` に JavaScript、宣言、source map を emit する
2. `exports`、`main`、`types` は `dist/` を指す
3. `files` は `dist`、docs、型設定、LICENSE、README に限定する
4. `pnpm verify` が `pnpm build` まで実行する
5. npm publish と認証設定は、この作業では実行していない

### `.npmrc` の現状

今入っているのは publish 設定ではなく、**依存解決の回避策**である:

```
public-hoist-pattern[]=fast-check
public-hoist-pattern[]=pure-rand
```

`fast-check` は `effect` の推移的依存（`effect/FastCheck` の re-export 経由）だが
pnpm が既定で hoist しないため、`tsc` が型を解決できない。
`pure-rand` は `fast-check` の実行時依存で、Vite が
フラットな `node_modules/fast-check` から解決できるように並べて hoist している。

## 6. キューロスターの互換性

`SoundCueId` はリテラル型のユニオンであり、**公開 API の一部**である。
mx-gameplay と mx-ui が文字列リテラルで直接参照する。

| 変更 | semver |
| --- | --- |
| キューの追加 | minor（既存の `switch` は網羅性チェックで壊れるが、それは意図した挙動） |
| `CueDefinition.baseGain` の調整 | patch（音量の微調整。API は変わらない） |
| `caption` テキストの変更 | minor（UI に表示される文字列が変わる） |
| キューの**削除・改名** | **major** |
| `CaptionEvent` へのフィールド追加 | minor |
| `CaptionReason` の値の追加 | minor（consumer の `switch` は網羅性で検出される） |

`master` を per-cue gain に含めるような算術の変更は、
API シグネチャが変わらなくても**実質的に破壊的**である。
音が二倍になったり半分になったりする。
[design-notes.md](./design-notes.md#dn-2) の回帰テストがこれを防いでいる。

## 7. アセットのバージョニング

plan.md §5.3 は「アセットは消費者に同梱（音声 → audio）」としている。
音声データは `AudioSampleManifest` で `ArrayBuffer` または URL として注入する。
`minecraftSoundManifest` は `sounds.json` の実体サウンドを URL manifest に変換し、
WebAudio アダプタは decode、cache、preload、失敗時の oscillator fallback を担当する。

このリポジトリは Minecraft の著作権付きバイナリアセットを同梱しない。標準サンプルの
動作確認用には `createOriginalSampleManifest()` が生成する小さな WAV を使用する。
消費者が提供するリソースパックの URL と音声差し替えは、URL または ArrayBuffer の
manifest の変更として扱う。大きなアセットを配布物へ含める方針は、実データを追加する時に
別途決定する。

# バージョニングと公開

## 1. 現在: `0.1.0`、未公開

`package.json`:

```json
"version": "0.1.0",
"publishConfig": { "registry": "https://npm.pkg.github.com", "access": "restricted" }
```

`publishConfig` は書いてあるが、**publish はまだ一度も行っていない**。

## 2. なぜまだ公開しないのか

plan.md §6 Step 0 / §8:

> npm 公開・バージョン bump 運用は**界面安定（4 週間 API ロック無変更）まで開始しない**
>
> リスク「新規構築初期は全界面が高 churn」→ 対策「npm 公開を遅らせ dev-meta workspace で開発。
> bump 連鎖を構造的に回避」

16 リポジトリが互いに依存している状態で早期に publish を始めると、
kernel の些細な変更が 15 リポジトリの version bump を誘発する。
開発初期は界面が動くのが当たり前なので、これは毎日起きる。

代わりに `mc-dev-meta` workspace で `workspace:*` 解決を使い、
モノレポと同等の DX で開発する。

### 現時点で `dependencies` に `effect` しか無い理由

スケルトン段階では**兄弟リポジトリへの依存を意図的に持たない**。

- 何も publish されていないので、`@nerima-games/mc-kernel` は解決できない
- スケルトンには import すべき兄弟のコードがまだ無い

意図された依存グラフは**コードとドキュメントの側に**記録してある:

- `scripts/check-dependency-whitelist.ts` の `REPOSITORY_POLICY.dependencyGraph`（16 行全部）
- [architecture.md](./architecture.md) の Mermaid 図

publish 開始時に、ボトムアップ（kernel → 各 tier1 → worldgen → …）で
**publish してから pin する**。

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
3. その状態で API を 4 週間変更していない（plan.md §6 Step 3 の API ロック条件）
4. WebAudio アダプタが実装済みで、`locked` → `ready` のアンロックが実ブラウザで動く
5. **キューロスターが確定している** — 現在は暫定 9 個。
   ロスターは公開 API の一部であり、キューの追加は semver-minor だが、
   キューの**削除・改名**は破壊的変更になる

「良さそうだから 1.0 にする」はしない。
**実消費者が 2 つ付いて初めて、界面が正しいかどうかの証拠が揃う。**

## 5. ビルドと publish のパイプライン

### 現状: ビルドステップが無い

`package.json`:

```json
"main": "./index.ts",
"types": "./index.ts",
"exports": { ".": "./index.ts" }
```

**TypeScript ソースを直接指している。** `tsconfig.base.json` の `noEmit: true` も同じ理由である。

これは `mc-dev-meta` workspace 内でのみ成立する構成である
（consumer 側がソースをコンパイルする）。

### 完成時に追加するもの

1. `tsconfig.build.json` の `noEmit` を外し、`dist/` に emit する
2. `exports` を `dist/index.js` + `dist/index.d.ts` に向ける
3. `files` から `domain` を外し `dist` を入れる
4. CI に `pnpm build` と、tag push での `pnpm publish` を追加
5. `.npmrc` に GitHub Packages の認証設定（`//npm.pkg.github.com/:_authToken=`）を追加

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

## 7. アセットのバージョニング（未確定）

plan.md §5.3 は「アセットは消費者に同梱（音声 → audio）」としている。
音声ファイルを npm パッケージに含めるとサイズが増え、
音声だけの差し替えでもパッケージ全体の bump が必要になる。

参照実装には音声ファイルが 1 つも無い（全てオシレータ合成）ため、前例が無い。

**この節が先に必要になることは当分ない。** 同梱するファイルが 0 件で、
サンプル再生パスも無いので、バージョニングすべきものがまだ存在しない
（[responsibility.md](./responsibility.md) §5-1 に実測がある）。
最初の音源がコミットされた日にこの節を決めれば足りる。

plan.md §5.3 の但し書きどおり、
**リソースパック機能を作る時に再検討**する。それまでは同梱する。

# @nerima-games/mc-audio

## 責務

WebAudio エンジン・効果音キューレジストリ・音楽コンテキスト（BGM 状態機械）・**字幕イベント発行**。

## 依存

`effect` と `@nerima-games/mc-kernel` のみ。
内部依存のホワイトリストは `@nerima-games/mc-kernel` だけを許可し、`pnpm check:deps` が機械的に強制している。

mc-audio は**シンク**である。押し込まれる側であって、押し返さない。
特に `mc-sim` を import してはならない（「プレイヤーはどこ？」は呼び出し側が渡す）。

mc-audio に依存するのは `mx-gameplay` と `mx-ui` の 2 つである。

## 最重要の不変条件: 字幕はオーディオゲートより前に発火する

**音が出せない状態でも字幕は出る。** 例外は無い。

- プレイヤーがミュートした → 字幕は出る（`reason: 'muted'`）
- ブラウザが自動再生を拒否した → 字幕は出る（`reason: 'gate-blocked'`）
- オーディオバックエンドが存在しない → 字幕は出る（`reason: 'unavailable'`）

字幕は耳が聞こえない、あるいはミュートで遊ぶプレイヤーのためにある。
オーディオが有効かどうかで門を作ると、まさにその人たちから字幕が消える。

参照実装で確定した挙動であり、ソースに理由まで書かれている
（`packages/game/application/sound-manager.ts:43-48`）。
ただし参照実装は**3 つあるゲートのうち 1 つしかテストしていなかった**。
`test/caption-gate.test.ts` が 3 つとも固定している。

## ドキュメント

実装に必要な情報は全て [`docs/`](./docs/) にある。**plan.md を読み直す必要は無い。**

| ファイル | 内容 |
| --- | --- |
| [docs/architecture.md](./docs/architecture.md) | 4 階層、16 リポジトリ依存グラフ、mc-audio の位置 |
| [docs/responsibility.md](./docs/responsibility.md) | 責務と非スコープ |
| [docs/public-api.md](./docs/public-api.md) | 公開 API（参照実装で検証済み） |
| [docs/minecraft-sounds.md](./docs/minecraft-sounds.md) | `sounds.json`、バリアント、サウンド再生 |
| [docs/free-music.md](./docs/free-music.md) | 追加可能なフリー音源、Minecraft 互換の BGM 定義、利用方法 |
| [docs/design-notes.md](./docs/design-notes.md) | 設計注意 + 回帰テスト |
| [docs/porting.md](./docs/porting.md) | 移植元と実測 LOC |
| [docs/testing.md](./docs/testing.md) | 検証要件と完了条件 |
| [docs/versioning.md](./docs/versioning.md) | 0.x → 1.0.0、publish 方針 |

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_24 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 24 以上と pnpm 11（`corepack` 推奨）を用意する。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | build / test / preview の全 TypeScript プロジェクトを型検査 |
| `pnpm lint` | oxlint（唯一の lint/format 設定）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`.oxlintrc.json` は 5 カテゴリすべてと個別 40 ルールが `warn`、`error` は 2 つだけ。このフラグが無かった頃は実質その 2 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect`） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測（文・分岐・関数・行の閾値は各 100%。[docs/testing.md](./docs/testing.md) 参照） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止 |
| `pnpm build` | `tsconfig.release.json` から declaration / source map 付きの `dist/` を生成 |
| `pnpm verify` | `typecheck && lint && check:deps && test && test:coverage && build` |

### 構成

```
src/index.ts                       公開バレル
src/domain/
  backend-port.ts   AudioBackendPort、AudioAvailability（3 状態のゲート）
  caption.ts        CaptionEvent、CaptionStream、visibleCaptions（純関数）
  cue.ts            キューロスターと定義テーブル
  engine.ts         planCue（純関数）と SoundCuePort。★字幕→ゲートの順序
  minecraft-music-data.ts     Minecraft BGM 定義・正規化・選択
  minecraft-music-planner.ts  Minecraft BGM 状態機械（純関数）
  minecraft-music.ts          上記の公開 re-export
  minecraft-ambient-sounds-data.ts     Minecraft ambient 定義・正規化
  minecraft-ambient-sounds-planner.ts  Minecraft ambient 状態機械（純関数）
  minecraft-ambient-sounds.ts          上記の公開 re-export
  minecraft-sounds* sounds.json の解析・マージ・バリアント解決・再生計画
  minecraft-sound-player.ts  mc-kernel の Position / ClockPort を使う高水準再生
  audio-sample.ts  ホスト非依存の sample manifest 型
  volume.ts         音量カテゴリと gain 算術
  webaudio-adapter.ts  WebAudio の生成・decode・cache・再生
scripts/
  check-dependency-whitelist.ts   依存境界のゲート
test/                             Vitest テストスイート（DOM も fake timer も使わない）
docs/                             実装情報
```

## なぜ DOM を持たないのか

`tsconfig.base.json` の `lib` に `"DOM"` が**入っていない**。
オーディオのリポジトリとしては奇妙に見えるが、意図的である。

ドメインの計画・キューレジストリ・音量算術・BGM 状態機械・字幕ストリームは純粋である。
`"DOM"` を締め出すことで WebAudio 固有の部分が `AudioBackendPort` の裏に**強制的に**回り、
jsdom も `AudioContext` も無しでドメイン部分をテストできる。

WebAudio アダプタは最後に書かれ、ブラウザAPIを注入可能な構造型の境界に閉じ込めている。

## 現状

WebAudio アダプタは実装済みである。ユーザジェスチャからの `unlock`、cue sample/tone の再生と停止、
master volume と mute、同時音数上限、Node/SSR の安全な unavailable fallback、
視線方向に追従する左右定位、冪等な `dispose` を提供する。ブラウザAPIは `WebAudioGlobalSurface` として注入するため、
全分岐を Node 上の fake で単体テストできる。

- **キューロスターは 17 個。** 参照実装の効果音ロスターを移植済み
- **オリジナルPCMサンプルを同梱。** `createOriginalSampleManifest()` は全 cue と End/portal 用の短い16-bit mono WAVを実行時生成する。外部アセット、DOM、fetch、著作権付き素材は不要
- URL または独自 `ArrayBuffer` の manifest も引き続き指定でき、未ロード・失敗時は tone 合成へフォールバックする
- `sounds.json` の namespace、replace マージ、weight バリアント、subtitle、attenuation を解析し、URL manifest と再生計画へ変換できる
- **サウンドボードプレビューは実装済み**（`apps/preview-soundboard`）
- **ビルドは実装済み。** `pnpm build` が `dist/`、型宣言、source map を生成し、`exports` は release 出力を指す。publish は公開判断と registry 認証を伴うため、このリポジトリでは実行していない
- **カバレッジ閾値は 100%。** 全対象指標をゲートとして検証する

### 標準サンプルバンク

```ts
import { Effect } from 'effect'
import { createOriginalSampleManifest, makeWebAudioBackend } from '@nerima-games/mc-audio'

const backend = await Effect.runPromise(makeWebAudioBackend({
  global: globalThis,
  sampleManifest: createOriginalSampleManifest(),
}))

await Effect.runPromise(backend.preloadSamples())
```

生成器はDOM非依存で、同じ `seed` と `sampleRate` から常に同じWAVを返す。block break/place、
footstep、mob、rain/thunder、End dragon、eye/frame/portal、End ambienceを標準manifestで網羅する。

## License

MIT

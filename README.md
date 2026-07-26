# @nerima-games/mc-audio

## 責務

WebAudio エンジン・効果音キューレジストリ・音楽コンテキスト（BGM 状態機械）・**字幕イベント発行**。

## 依存

`effect` と `@nerima-games/mc-kernel` のみ。
直接依存のホワイトリストは**空集合**であり、`pnpm check:deps` が機械的に強制している。

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
| [docs/design-notes.md](./docs/design-notes.md) | 設計注意 + 回帰テスト |
| [docs/porting.md](./docs/porting.md) | 移植元と実測 LOC |
| [docs/testing.md](./docs/testing.md) | 検証要件と完了条件 |
| [docs/versioning.md](./docs/versioning.md) | 0.x → 1.0.0、publish 方針 |

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_22 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 22 以上と pnpm 9.15.0（`corepack` 推奨）を用意する。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json` と `tsconfig.test.json` の両方を型検査 |
| `pnpm lint` | oxlint（唯一の lint/format 設定）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect`） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測（閾値は未設定。[docs/testing.md](./docs/testing.md) 参照） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止 |
| `pnpm verify` | `typecheck && lint && check:deps && test`。CI と同じ |

### 構成

```
index.ts                          公開バレル
domain/
  backend-port.ts   AudioBackendPort、AudioAvailability（3 状態のゲート）
  caption.ts        CaptionEvent、CaptionStream、visibleCaptions（純関数）
  cue.ts            キューロスターと定義テーブル
  engine.ts         planCue（純関数）と SoundCuePort。★字幕→ゲートの順序
  music.ts          BGM 状態機械（純関数）
  volume.ts         音量カテゴリと gain 算術
scripts/
  check-dependency-whitelist.ts   16 リポジトリ共通のゲート
test/                             61 tests（DOM も fake timer も使わない）
docs/                             実装情報
```

## なぜ DOM を持たないのか

`tsconfig.base.json` の `lib` に `"DOM"` が**入っていない**。
オーディオのリポジトリとしては奇妙に見えるが、意図的である。

現在出荷している全て（キューレジストリ・音量算術・BGM 状態機械・字幕ストリーム）は純粋である。
`"DOM"` を締め出すことで WebAudio 固有の部分が `AudioBackendPort` の裏に**強制的に**回り、
jsdom も `AudioContext` も無しで全部テストできる。

WebAudio アダプタは最後に書く。最初ではない。

## 現状

**このリポジトリはまだ叩き台（pre-audit first cut）である。**

- **WebAudio アダプタは未実装。** `locked` → `ready` のユーザジェスチャアンロックは
  参照実装に存在しないので新規設計になる
- **キューロスターは暫定 9 個。** 参照実装は 17 個。最終ロスターは
  キューを鳴らす mx-gameplay のルールと一緒に決まる
- **音声アセットは未同梱。** 参照実装は全てオシレータ合成で、音声ファイルが 1 つも無い
- **サウンドボードプレビューは未実装**（plan.md §3.6 の完了条件）
- **ビルド／publish はまだない。** `exports` は TypeScript ソースを直接指している
- **カバレッジ閾値は未設定。** 99% ゲートは完成条件到達時に有効化する

## License

MIT

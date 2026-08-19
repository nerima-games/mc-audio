# 移植元

参照実装: `takeokunn/ts-minecraft`（凍結。仕様書 + テストオラクルとして扱う）。

**LOC は全て `wc -l` の実測値である。plan.md の見積もりは信用しないこと。**

---

## 0. plan.md §3.6 の LOC 表記について

> plan.md §3.6 移植元:
> `packages/game/infrastructure/audio-engine.ts`、SoundCaptionPort、sound-manager（**~1k LOC**）

実測すると **993 LOC / 26 ファイル**。`~1k` は妥当な見積もりである。

ただし plan.md が挙げた 3 つは全体の一部にすぎない:

```
audio-engine.ts        163
sound-caption-port.ts   15
sound-manager.ts        95
                       ───
                       273    ← plan.md が名指ししたもの
                       993    ← 実際のオーディオ関連ソース総量
```

音楽まわり（`music-manager*` 6 ファイル 245 LOC）と
字幕 UI（`sound-captions.ts` 83 LOC）が抜けている。

---

## 1. 中核: `packages/game`（オーディオの本体）

| LOC | パス | 役割 | mc-audio での行き先 |
| ---: | --- | --- | --- |
| 163 | `packages/game/infrastructure/audio-engine.ts` | WebAudio エンジン。**3 つのゲートのうち 2 つがここ** | `domain/webaudio-adapter.ts` / `webaudio-runtime.ts`（✅） |
| 36 | `packages/game/infrastructure/audio-context-helpers.ts` | ガード付き `AudioContext` 生成 | `domain/webaudio-runtime.ts`（✅） |
| 27 | `packages/game/domain/audio-types.ts` | `ToneRequest` / `ToneHandle` の Schema | `domain/backend-port.ts` |
| 14 | `packages/game/domain/audio-engine-port.ts` | `AudioEnginePort` タグ | `domain/backend-port.ts` |
| 2 | `packages/game/domain/audio-utils.ts` | `clamp01` / `clampPan` | `domain/volume.ts` |
| 29 | `packages/game/domain/sound-spatial.ts` | 距離減衰とパン | `domain/volume.ts` |
| 95 | `packages/game/application/sound-manager.ts` | **字幕→ゲートの順序がここ (`:43-63`)** | `domain/engine.ts` |
| 38 | `packages/game/application/sound-manager.types.ts` | 17 キューのユニオン、`satisfies` による対応強制 | `domain/cue.ts` |
| 42 | `packages/game/application/sound-manager.config.ts` | `SOUND_LIBRARY` 合成テーブル | `domain/cue.ts` |
| 42 | `packages/game/application/sound-manager-playback.ts` | 純粋なプランナ、gain 算術 | `domain/engine.ts` + `domain/volume.ts` |
| 15 | `packages/game/application/sound-caption-port.ts` | 字幕 Port（単一メソッド） | `domain/caption.ts`（**拡張して移植**） |
| **503** | **小計（SFX + 字幕 Port）** | | |

## 2. 音楽（BGM）

| LOC | パス | 役割 |
| ---: | --- | --- |
| 19 | `packages/game/application/music-manager.ts` | サービスタグ |
| 11 | `packages/game/application/music-manager.types.ts` | `MusicEnvironment` |
| 15 | `packages/game/application/music-manager.config.ts` | トラック定義、`DEFAULT_CAVE_THRESHOLD_Y` |
| 43 | `packages/game/application/music-manager-state.ts` | **純粋な遷移計画 (`:21-43`)。最も価値が高い** |
| 15 | `packages/game/application/music-manager-environment.ts` | **純粋な環境判定 (`:10-15`)** |
| 142 | `packages/game/application/music-manager-runtime.ts` | effect 側のドライバ |
| **245** | **小計** | |

`music-manager-state.ts` と `music-manager-environment.ts` は
**そのまま持ってこられる**（`domain/music.ts` に移植済み）。
純関数で 58 LOC、テストは 86 LOC。投資効率が最も良い部分である。

## 3. 字幕の DOM 側（mc-audio には来ない → mx-ui へ）

| LOC | パス | 注意 |
| ---: | --- | --- |
| 83 | `packages/presentation/hud/sound-captions.ts` | モジュールレベル mutable。重複排除・上限・期限が全部ここ |
| — | `index.html:469` | `<div id="sound-captions" role="log" aria-live="polite">` |
| — | `index.html:130-149` | 字幕 CSS |

**重要**: 重複排除 / 5 行上限 / 2500ms 期限のロジックは
mc-audio 側（`visibleCaptions`）に引き上げ済みである。
mx-ui は描画だけを持つ。→ [design-notes.md](./design-notes.md#dn-3)

## 4. 配線・キュー発火側（mc-audio には来ない）

| LOC | パス | 行き先 |
| ---: | --- | --- |
| 15 | `packages/app/application/main/layers/game-logic-audio-ports.ts` | mc-compose |
| 10 | `.../game-logic-sound-bundles.ts` | mc-compose |
| 9 | `.../game-logic-music-bundles.ts` | mc-compose |
| 8 | `.../game-logic-presentation-audio-bundles.ts` | mc-compose |
| 6 | `packages/app/application/frame/frame-service-types/audio.ts` | mc-compose |
| 22 | `.../physics-stage-survival/footstep-sound-logic.ts` | **mx-gameplay** |
| 23 | `.../physics-stage-survival/footstep-sound-data.ts` | **mx-gameplay** |
| 69 | `.../physics-stage-survival/weather-sound.ts` | **mx-gameplay** |

足音と天候音は「いつ鳴らすか」のルールなので動詞側である（plan.md §2.3-1）。

## 5. 設定（部分的に関係する）

| LOC | パス | 該当箇所 |
| ---: | --- | --- |
| 79 | `packages/game/application/settings.schema.ts` | `:65` 字幕 ON/OFF、`:75-77` 音量 3 種 |
| 107 | `packages/game/application/settings-service.ts` | `:25` `:34-37` 既定値 |
| 82 | `packages/app/application/frame/frame-settings-apply.ts` | `:47-82` `applyAudioSettings` |
| 272 | `packages/presentation/settings/settings-overlay-dom.ts` | 音量スライダー → **mx-ui** |
| 462 | `packages/presentation/settings/settings-overlay.ts` | → **mx-ui** |

音量の**値**は mc-audio の語彙だが、**保存と UI** は他リポジトリである。

## 6. テスト資産（1074 LOC / 13 ファイル）

| LOC | パス | 移植価値 |
| ---: | --- | --- |
| 256 | `packages/game/test/sound-manager.test.ts` | **最高。`:230-241` が字幕→ゲート順序、`:54-57` が master 二乗防止** |
| 152 | `packages/game/test/music-manager.test.ts` | 高 |
| 54 | `packages/game/test/music-manager-state.test.ts` | **高。遷移表を網羅** |
| 32 | `packages/game/test/music-manager-environment.test.ts` | **高。`<` vs `<=` の境界** |
| 50 | `packages/game/test/sound-manager-playback.test.ts` | 高 |
| 135 | `packages/game/test/audio-types.test.ts` | 中 |
| 35 | `packages/game/test/audio-utils.test.ts` | 低（audio-types.test.ts と重複） |
| 28 | `packages/game/test/sound-spatial.test.ts` | 高 |
| 133 | `packages/presentation/test/sound-captions.test.ts` | 中 → mx-ui へ |
| 95 | `.../interaction-mob-sound.test.ts` | → mx-gameplay |
| 79 | `.../weather-sound.test.ts` | → mx-gameplay |
| 14 / 11 | `.../footstep-sound-{data,logic}.test.ts` | → mx-gameplay |

### テストが存在しない領域（＝ mc-audio が埋めるべき穴）

- `packages/game/infrastructure/audio-engine.ts` — **テスト 0 本**
- `packages/game/infrastructure/audio-context-helpers.ts` — **テスト 0 本**

つまり `AudioContext` を構築するテストも、`resume()` を検証するテストも
リポジトリ全体に存在しない。字幕→ゲートの不変条件は
**設定ゲートのレベルでしか固定されていない**。
→ [design-notes.md](./design-notes.md#dn-1)

## 7. 参照実装のドキュメント

| LOC | パス | 注意 |
| ---: | --- | --- |
| 1338 | `docs/explanations/game-mechanics/core-features/sound-music-system.md` | 説明文書 |
| 163 | `phase/14-sound-music.md` | 実装フェーズの記録 |
| 203 | `docs/resources/recommended-sound-assets.md` | **構想のみ。音声ファイルは 1 つも無い** |

## 8. 移植の進め方

1. **`music-manager-state.ts` (43) と `music-manager-environment.ts` (15) を読む** —
   純関数 58 LOC。そのまま移植でき、テストも 86 LOC で付いてくる（✅ 完了）
2. **`sound-spatial.ts` (29) と `sound-manager-playback.ts` (42) を読む** —
   gain 算術の全て（✅ 完了）
3. **`sound-manager.ts:43-63` を読む** — 字幕→ゲートの順序。**これが本丸**（✅ 完了）
4. **`sound-manager.types.ts` (38) + `sound-manager.config.ts` (42) を読む** —
   ロスターと `satisfies` の技法（✅ 部分完了、ロスターは暫定）
5. **`audio-context-helpers.ts` (36) を読む** — WebAudio アダプタを書くとき（✅ `webaudio-runtime.ts`）
6. **`audio-engine.ts` (163) を読む** — 同上。**ただしテストが無いので鵜呑みにしない**（✅ `webaudio-adapter.ts` と契約テスト）

### Minecraft の音声リソース

`src/domain/minecraft-sounds-*.ts` は `sounds.json` の namespace、event alias、
weight、volume、pitch、stream、attenuation distance、preload を純粋に扱う。
`minecraftSoundManifest` は著作権付きバイナリをリポジトリへ複製せず、配布元 URL を
`AudioSampleManifest` に変換する。`docs/minecraft-sounds.md` に公開 API と制約をまとめる。

### そのまま移植してはいけないもの

| 対象 | 理由 |
| --- | --- |
| `sound-caption-port.ts` の Port 形状 | 単一メソッドの投げっぱなし。`atSecs` と `reason` を足して拡張する |
| `sound-captions.ts` のモジュールレベル mutable | 注入不可能でテストしにくい。純関数に引き上げる |
| `audio-engine.ts` の autoplay 処理 | `resume()` の拒否を握り潰しているだけ。`locked` 状態を設計し直す |
| ハンドル id をゲート前に採番する形 | 「ハンドルが返った＝鳴った」と誤解される |

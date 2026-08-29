# サウンドボードプレビュー

```
pnpm preview                        # インタラクティブ（TTY）
pnpm preview --once --ascii         # 1 フレームだけ出力（pipe / diff できる）
pnpm preview --panel graph --play blockBreak
```

plan.md §3.6 が要求する「**サウンドボードプレビュー（全キューを一覧から試聴）**」。
`docs/testing.md` §3 の 5 項目を目視で確認するためのもの。

---

## 0. 最初に: **ここでは音は鳴らない**

ターミナルアプリなので当然だが、これは「制約」ではなく**設計の出発点**である。

音が鳴らないプレビューは、放っておくと「キュー名の一覧＋それっぽい ASCII 絵」になる。
それは**無いより悪い**。検証したように見えるからである。

だからこのアプリは**自分では何も主張しない**。
本物の `makeSoundCueService` を、本物の `makeWebAudioBackend` の上で、
テストと同じ `test/fake-webaudio.ts` に向けて動かし、
**その結果を読み出して表示するだけ**である。

| 画面の数字 | 出どころ |
| --- | --- |
| 字幕 | `src/domain/engine.ts` が実際に発火したもの → `visibleCaptions` |
| ノードグラフ | アダプタが実際に `connect` した記録（fake のログ） |
| gain | `planCue` と `masterNodeGain` |
| エンベロープ | `gainAt` のサンプリング |
| availability | 毎フレーム、アダプタに聞いている |

**再計算はどこにもしていない。**
再計算するプレビューは、コードが壊れた後も正しい絵を描き続ける。
それがプレビューが腐る典型的な形である。

---

## 1. 何が**確認できる**か

`docs/testing.md` §3 の 5 項目に対応している。

### 1-1. 全キューの一覧と「試聴」 — `board` パネル

17 キュー全部が、gain・空間化の有無・字幕テキスト・`reason` と一緒に並ぶ。
`enter` で選択中のキューを発火する。

`caption` 列は **「字幕が無い」と「字幕が消された」を区別する**。
`inventoryOpen` / `inventoryClose` は `caption: null` が**作者の意図**であり
（`src/domain/cue.ts`）、ゲートで消えたのとは別物である。参照実装はここを混同していた。

### 1-2. ロック中に**字幕だけが出る** — DN-1 の目視版 ★最重要

`pnpm preview` を起動して、`u` を押さずに `enter` を押す。

```
> blockBreak         --    spatial "Block breaks"      gate-blocked
...
captions  (1 visible of 1 fired)
  "Block breaks"        gate-blocked  right  0.00s old
```

gain は `--`（トーンは組まれていない）。**字幕は出ている。**
`tab` で `graph` パネルに移ると、何が拒否したのかが出る:

```
  REFUSED before any node was built: the browser autoplay policy has not been satisfied.
  would have built:  oscillator -> gain -> panner -> master -> destination
  ...and built none of it. The caption still went out; see the board panel.
  press u — that is the user gesture
```

参照実装は**この状態でこのグラフを全部組んで、ハンドルを返していた**
（`audio-engine.ts:46-49` が `resume()` の拒否を握り潰していた）。
上位からは成功と区別できなかった。

`u` を押すと `locked -> ready` になり、同じキューが `audible` になる。

### 1-3. master が二乗になっていないこと — `mix` パネル

DN-2 は「聞いて気付く」種類のバグではない（`0.5` が `0.25` に聞こえるだけで
エラーにならない）。数字で見れば一目である。

```
gain for blockBreak
  per-cue gain          0.3000   must NOT change when master changes
  master node gain      0.8000   the only place master becomes a number
  what a speaker gets   0.2400   the product, applied once
```

`1` / `!` で master を動かす。**左の列が動いたら二重適用**である。

### 1-4. 空間化 — `mix` パネル

`,` `.` で音源を X 軸方向に動かす。距離・減衰・パンが同時に動く。

```
  distance                4.00 blocks   attenuation is 1/(1 + d/12)
  attenuation           0.7500
  pan                   0.3333
                      ------------|---O--------
```

パンのバーは**中央にマークがある**。「ど真ん中」と「わずかに左」が
区別できないと、非空間キューの `pan` 省略（`src/domain/engine.ts` は
誤解を招く 0 を返さない）が確認できないためである。

### 1-5. BGM が同じ環境で再起動しないこと — `music` パネル

`w` / `s` で Y、`n` で昼夜、`m` で状態機械を 1 回まわす。

同じ環境でもう一度 `m` を押すと:

```
  stop active track: false   play: nothing
log
  music: NO ACTION — already playing the desired track
```

**計画そのものを表示している**のが要点である（DN-5）。
再生中のトラックだけを見せていたら、毎フレーム再起動する実装と見分けが付かない。

閾値もここで見える: `playerY = 40` は `day`、`39` で `cave`。
比較が `<` であって `<=` ではないこと（DN-4）。

### 1-6. おまけ: このプレビューだけで見られるもの

| キー | 何が起きるか |
| --- | --- |
| `i` | **iOS の着信**。`ready` の context が、誰も頼んでいないのに `interrupted` = `locked` になる。`'interrupted'` は `lib.dom.d.ts` をコンパイルして初めて見つかった 4 つ目の状態である（`src/domain/webaudio-surface.ts`） |
| `x` | context を閉じる。`unavailable` になり、**`u` を押しても戻らない**。`locked` と `unavailable` を分けている理由がここに出る |
| `-` `+` | オーディオ時計を進める。トーンが `onended` を迎え、ノードが解放されるのが `graph` パネルの数字で見える |
| `[` `]` | 字幕時計を進める / 戻す。2.5 秒で字幕が消えるのを、2.5 秒待たずに確認できる |

起動オプションでも、開発機では再現しない**実在のブラウザ状態**に入れる:

| フラグ | どのブラウザ |
| --- | --- |
| `--absent` | Node / SSR / Web Audio の無いブラウザ |
| `--refuse` | `resume()` を決して通さないブラウザ |

**この 2 つは参照実装では一度も実行できなかった構成である。**
検出が `typeof AudioContext === 'undefined'` というグローバル読みだったため、
Node のテストからは偽にできなかった（`docs/porting.md` §6 —
`audio-engine.ts` と `audio-context-helpers.ts` のテストは 0 本）。

---

## 2. 何が**確認できない**か

ここが正直でないと、このアプリは有害になる。

### 2-1. 音に関すること — **全部**

- クリック（不連続）が実際に消えているか。
  エンベロープの**形**は `gainAt` の算術として `test/envelope.test.ts` で厳密に固定してあるが、
  それがブラウザで実際にクリックを消すかは**聴かないと分からない**
- 12 ブロック先の足音が「無視できるほど小さく、気付ける程度に大きい」か
- 174.61Hz と 130.81Hz が「2 つのビープ」ではなく「別の曲」に聞こえるか
- 17 キューが互いに区別できるか。**現状すべて正弦波である**
  （キューごとの `ToneRequest.wave`。未指定時のみ `DEFAULT_TONE_WAVE`）
- レイテンシ、デバイスの遅延、Bluetooth

### 2-2. ブラウザが実際にどうするか

`test/fake-webaudio.ts` は**拒否するかどうかを教えられている**。
`--refuse` は「拒否されたときアダプタがどう振る舞うか」を見せるのであって、
「このブラウザが拒否するか」を予言するものではない。

同様に、どのジェスチャが activation として数えられるか、
その有効期間、バックグラウンドタブの扱いは一切モデル化していない。

### 2-3. オーディオのタイミング

fake の `currentTime` は呼ばれた分だけ進む。
サンプルレートも 128 フレームのレンダー量子も出力レイテンシもドリフトも無い。
実ブラウザはスケジュールを量子に丸め、その上にレイテンシを乗せるので、
「t で終われ」と言ったランプは t で終わらない。

**これを fake に実装するのは、実装しないより悪い。**
もっともらしくて間違った数字が出て、
「どう聞こえるか分からない」が「どう聞こえるかテスト済み」に化けるからである。
詳細は `test/fake-webaudio.ts` のヘッダ。

### 2-4. ブラウザでしか答えられないこと（＝ 次にやること）

`docs/testing.md` §4-2 の完了条件は
「`AudioBackendPort` の契約テストが**実ブラウザで** green」である。
このプレビューはそれを**満たさない**。満たすのは:

1. 実ブラウザでの `locked -> ready`（実際のクリックで）
2. 実機 iOS での `interrupted` 遷移
3. クリックが消えたことの試聴

ブラウザ版サウンドボードは、このアプリの**代わり**ではなく**隣**に置く。
ブラウザ版では `--stats` 相当のことができない（パイプもできないし grep もできない）し、
`--absent` の状態を作ることもできない。

---

## 3. 制約

- **`mc-playground-kit` は使っていない**（`docs/architecture.md` §4-2）。
  ターミナルだけで起動する
- **`apps` は `SCAN_ROOTS` に入っている**ので、import は他のソースと同じゲートを通る。
  このリポジトリ自身のモジュールと `effect` 以外は import していない
- **壁時計を読まない**。`Date.now()` / `new Date()` / `performance.now()` は使わず、
  `mc-kernel-allow-time-source` の逃げ道も使っていない。
  仮想時計が 2 つあり、それぞれキーで進める（`terminal.ts` に理由）
- `pnpm verify` はこのアプリを**実行しない**。
  `tsconfig.preview.json` が型検査し、`pnpm lint` が lint し、
  `test/soundboard-preview.test.ts` が純粋な部分を固定する

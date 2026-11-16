# Minecraft サウンドレジストリ

`minecraft-sounds` は Minecraft の `sounds.json` と同じ形式のイベント定義を
ホスト非依存の型へ変換するドメイン API である。このリポジトリは Minecraft のイベント定義も
音声バイナリも同梱しない。ゲーム側が `sounds.json` 形式のデータと、
resource pack の URL または読み込み済みの `ArrayBuffer` を渡す。

## 解析とマージ

```ts
import { parseMinecraftSoundsJson } from '@nerima-games/mc-audio'

const registry = parseMinecraftSoundsJson(soundsJson, {
  namespace: 'minecraft',
})
```

入力は、ホストが用意した event id をキーにする `sounds.json` 形式のオブジェクトである。各 `sounds` 要素は
文字列、または次の属性を持つオブジェクトにできる。

- `name`: `namespace:path`。省略した namespace は parser の既定値を使う
- `type`: `sound` または `event`（既定値は `sound`）
- `volume`、`pitch`、`weight`、`stream`、`attenuation_distance`、`preload`

既定値はそれぞれ `1`、`1`、`1`、`false`、`16`、`false`。`volume` と `pitch` は非負の有限値、
`attenuation_distance` は正の有限値、`weight` は正の整数として検証される。公式データには
`volume: 2.0` や `pitch: 2.4` も含まれるため、旧実装の上限値は設けていない。namespace、
パス、未知の属性、空の variant 配列も解析時に検証される。`.ogg` suffix は正規化時に
一度だけ取り除かれる。

複数 namespace や resource pack の優先順位は、パース後に次で明示的に適用する。

```ts
import { mergeMinecraftSoundRegistries } from '@nerima-games/mc-audio'

const merged = mergeMinecraftSoundRegistries(baseRegistry, overlayRegistry)
```

overlay の event に `replace: true` があれば event 全体を置換し、それ以外は既存の
variant を保ったまま overlay を追加する。入力を暗黙に書き換えないため、マージ結果は
新しい registry で返る。

## variant 解決と asset manifest

```ts
import {
  minecraftSoundManifest,
  resolveMinecraftSound,
  selectMinecraftSoundVariant,
} from '@nerima-games/mc-audio'

const resolved = resolveMinecraftSound(registry, 'minecraft:block.stone.break', 0.25)
const manifest = minecraftSoundManifest(registry, '/resource-pack')
```

`weight` による選択は、`random` を `[0, 1)` に正規化して決定的に行う。`type: event`
は別 event を再帰解決し、循環参照はエラーにする。`minecraftSoundManifest` は registry
から参照される sound を収集し、次の形の URL manifest を返す。

```text
/resource-pack/assets/minecraft/sounds/block/stone/break.ogg
```

WebAudio 側へ渡す場合は、manifest を `sampleManifest` に指定し、URL の取得方法を
`loadSampleData` で注入する。`ArrayBuffer` を使うホストは `{ kind: 'array-buffer', data }`
を manifest に入れられる。manifest にある sound は高水準プレイヤーから初回再生した時に
遅延ロードされ、decode 済みの buffer は backend 内で cache される。同じ sound id の同時
ロードも共有される。クリック直後の遅延を避けたいホストは、ユーザー操作後または起動時に
`preloadSamples` を明示的に呼べる。

```ts
const backend = yield* makeWebAudioBackend({
  global: globalThis,
  loadSampleData: (url) => fetch(url).then((response) => response.arrayBuffer()),
  sampleManifest: manifest,
})

yield* backend.unlock // クリックなどのユーザー操作から呼ぶ
yield* backend.preloadSamples() // 任意。初回再生前に decode を済ませる場合
```

`stream` と `preload` は registry と解決結果に保持される。`stream: true` の source は、
ホストが `preloadStream` / `createStreamSource` を提供すればそれを優先し、提供しない場合や
ストリームの準備に失敗した場合は、同じ source を `AudioBuffer` として decode/cache する。
ただし HTTP の逐次 streaming、resource pack 自動取得、マイク録音、`AudioWorklet` はこの
package の API に含めない。必要な loader はホスト側で実装し、`AudioSampleManifest` と
`AudioBackend` の境界へ渡す。

## 高水準再生

`makeMinecraftSoundPlayer(registry, randomSource)` は mc-kernel の `Position` と `ClockPort` を直接利用し、
local な同名型や時刻取得を持たない。`AudioBackendPort`、`CaptionStream`、`ClockPort` を
Effect の Layer で提供すると、subtitle を audio gate より先に発行してから音を再生する。
`randomSource` は variant 選択のための必須の注入点であり、ゲームの乱数サービスを渡す。

```ts
const playback = yield* player.play('minecraft:block.stone.break', {
  listener,
  position: source,
})
```

`position` と `listener` が両方ある場合は、variant の `attenuation_distance` に対する
線形 cutoff と listener の forward vector から gain/pan を計算する。backend が `locked`、`unavailable`、または呼び出し側が
`enabled: false` の場合でも、caption は対応する reason とともに発行される。

## 同梱する音とデータの範囲

mc-audio は vanilla の sound-event カタログを同梱せず、Mojang の `sounds.json` に由来する値も
含まない。`sounds.json` 形式のデータで再生する場合は、ホストが自分のデータを用意して
`parseMinecraftSoundsJson` に渡す。

mc-audio 自身が同梱する音は、独自に定義した cue ID（`src/data/cue-definitions.ts` と
`audio/effects/manifest.json`）と、`mc-audio:music/<scene>` の曲（`audio/music/manifest.json`）だけである。
これらの音量、ピッチ範囲、並び順は、このプロジェクトが独自に決めたサウンドデザインである。音源は
`scripts/audio/generate-assets.mjs` で生成し、一部は `audio/CREDITS.md` に記載した CC0 パックから取り込んでいる。配信方法は [audio-assets.md](./audio-assets.md) に記載する。

## `ambient_sounds`

Java Edition の data-driven audio にある `minecraft:audio/ambient_sounds` を、音声
データの正規化、純粋な tick 計画、registry 経由の再生に分離して扱う。定義の既定値は
空で、`loop` は連続再生、`mood` は遅延付きの空間音、`additions` は tick ごとの確率音である。

```ts
import {
  initialMinecraftAmbientSoundsState,
  makeMinecraftAmbientSoundsPlayer,
  planMinecraftAmbientSounds,
  type MinecraftAmbientSoundsDefinition,
} from '@nerima-games/mc-audio'

const definition = {
  loop: 'minecraft:ambient.cave',
  mood: {
    sound: 'minecraft:ambient.mood',
    tick_delay: 80,
    block_search_extent: 8,
    offset: 0,
  },
  additions: [{ sound: 'minecraft:ambient.addition', tick_chance: 0.01 }],
} satisfies MinecraftAmbientSoundsDefinition

const plan = planMinecraftAmbientSounds({
  definition,
  cameraPosition,
  moodResolver: resolveMoodFromWorld,
  randomSource: gameRandom,
  state: initialMinecraftAmbientSoundsState(),
  tick,
})
```

`moodResolver` は mood が camera 位置で due になったときだけ呼ばれ、正規化済みの
`block_search_extent`、`tick_delay`、`offset` と `randomSource` を受け取る。ホスト側の
world resolver は光量サンプリングと暗さに応じた判定を行い、`{ position, delayTicks }`
を返す。`position: null` はその tick の mood 音を抑制し、resolver を省略した場合も
mood は再生されないが、次回判定は通常どおり進む。音声ライブラリは world/block の検索や
光量計算を行わず、`mc-kernel` の `Position` を受け取って純粋な計画関数と
`makeMinecraftAmbientSoundsPlayer` の再生経路を保つ。planner は mood command に `offset`
を保持し、player はそれを音源との距離へ加算して減衰だけに適用する。`randomSource` は
additions とホスト側 mood resolver に注入して使い、暗黙の `Math.random` は使わない。

音声イベントは既存の `MinecraftSoundRegistry` で解決されるため、resource pack の
`sounds.json` と `AudioSampleManifest` をそのまま共有できる。公式の定義とフィールドは
[Minecraft Java Edition Snapshot 25w42](https://feedback.minecraft.net/hc/en-us/articles/40320457571725-Minecraft-Java-Edition-Snapshot-25w42)
に対応する。公式音声バイナリは同梱せず、ホストが権利を持つ `.ogg` を manifest へ渡す。

## `minecraft:audio` component

公式の data-driven audio component は、音楽・ambient・Firefly Bush の設定を同じ JSON から正規化できる。

```ts
import {
  canPlayMinecraftFireflyBushIdleSounds,
  parseMinecraftAudioComponent,
} from '@nerima-games/mc-audio'

const audio = parseMinecraftAudioComponent({
  'minecraft:audio/background_music': {
    default: {
      sound: 'minecraft:music.game',
      min_delay: 12_000,
      max_delay: 24_000,
    },
  },
  'minecraft:audio/music_volume': 0.8,
  'minecraft:audio/firefly_bush_sounds': true,
  'minecraft:audio/ambient_sounds': {
    loop: 'minecraft:ambient.cave',
    mood: {
      sound: 'minecraft:ambient.mood',
      tick_delay: 80,
      block_search_extent: 8,
      offset: 0,
    },
  },
})
```

`audio.backgroundMusic` は `makeMinecraftMusicPlayer` の `backgroundMusic` へそのまま渡せる。
正規化結果の `null` は公式コンポーネントの省略を表し、音楽を無効にする。プレイヤー API の
`backgroundMusic` 自体を省略した場合だけ、組み込みの通常・水中・クリエイティブ定義へ
フォールバックする。`audio.musicVolume` は `musicVolume` へ、`audio.ambientSounds` は ambient planner の
`definition` へ渡す。`music_volume` は 0〜1、未指定値は `null` になる。`background_music` は
`default`、`underwater`、`creative` を持ち、現在の camera が解決したキーだけが選択される。
`ambient_sounds` は loop、mood、additions を正規化し、world/block 検索そのものはホスト側へ残す。

`background_music` のキーに空オブジェクトを指定すると、その環境の音楽を明示的に無効化できる。
たとえば `{ default: {} }` は通常環境を無音にし、`background_music` 自体を省略した場合の組み込み定義へのフォールバックとは異なる。

`firefly_bush_sounds` は boolean として正規化され、省略時の `null` は公式既定値 `false` を表す。
Firefly Bush の idle 音を発行する直前に、ホストが解決した遮蔽状態を渡して
`canPlayMinecraftFireflyBushIdleSounds({ fireflyBushSounds: audio.fireflyBushSounds, belowBlockId, belowOpaqueBlock })`
を使う。`belowBlockId` を渡した場合は `@nerima-games/mc-kernel` のブロックレジストリから光透過性を決め、
`belowOpaqueBlock` は block ID を渡せないホストのフォールバックになる。未知の block ID は `RangeError` で拒否する。
`true` かつ opaque block の直下でない場合だけ、`minecraft:block.firefly_bush.idle` を既存の `MinecraftSoundPlayer` で再生する。
idle tick と block position/light lookup はホスト側の責務であり、ライブラリはそこを推測しない。
この boolean と遮蔽条件は [Minecraft Java Edition 1.21.11](https://feedback.minecraft.net/hc/en-us/articles/41809981427213-Minecraft-Java-Edition-1-21-11-Mounts-of-Mayhem) の仕様に合わせている。

`makeMinecraftMusicPlayer` は、最初の曲を `MINECRAFT_MUSIC_STARTING_DELAY_TICKS`（100 tick）の後に選ぶ。
組み込みの通常・水中・クリエイティブ定義は、`minecraft:music.game`、`minecraft:music.under_water`、
`minecraft:music.creative` を 12,000〜24,000 tick の間隔で選ぶ。これらのイベントの音源は mc-audio に含まれないため、
組み込み定義で鳴らすにはホストの registry にこれらのイベントを定義する。環境は水中をクリエイティブより優先して解決する。
`musicVolume` が変わると、gain を 1 tick あたり `MINECRAFT_MUSIC_GAIN_STEP`（0.05）ずつ目標値へ近づける。

旧来の biome 音楽リストも重み付きで扱える。

```ts
const biomeMusic = [
  {
    data: {
      sound: 'minecraft:music.game',
      min_delay: 12_000,
      max_delay: 24_000,
    },
    weight: 2,
  },
  {
    data: {
      sound: 'minecraft:music.menu',
      min_delay: 12_000,
      max_delay: 24_000,
    },
    weight: 1,
  },
] as const

yield* player.tick({
  biomeMusic,
  context: { creative: false, underwater: false },
})
```

`weight` は正の整数で、選択後は再生中の曲を保持する。曲が終了するまで再選択せず、
`replace_current_music` が明示された場合だけ現在の曲を差し替える。

音源の位置解決には `mc-kernel` の `CameraPoseSnapshot` も渡せる。

```ts
yield* soundPlayer.play('minecraft:block.stone.break', {
  camera,
  position: source,
})
```

`camera.position` は `listener` の代わりに使われ、明示した `listener` がある場合はそちらを優先する。

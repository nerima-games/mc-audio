# Minecraft サウンドレジストリ

`minecraft-sounds` は Minecraft の `sounds.json` に相当するイベント定義を、
ホスト非依存の型へ変換するドメイン API である。著作権付きの公式音声バイナリは
このリポジトリに含めず、ゲーム側が resource pack の URL または読み込み済みの
`ArrayBuffer` を渡す。

## 解析とマージ

```ts
import { parseMinecraftSoundsJson } from '@nerima-games/mc-audio'

const registry = parseMinecraftSoundsJson(soundsJson, {
  namespace: 'minecraft',
})
```

入力は event id をキーにした `sounds.json` オブジェクトである。各 `sounds` 要素は
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

`position` と `listener` が両方ある場合は attenuation distance と listener の forward
vector から gain/pan を計算する。backend が `locked`、`unavailable`、または呼び出し側が
`enabled: false` の場合でも、caption は対応する reason とともに発行される。

## 26.2 sound-event catalog

`MINECRAFT_26_2_SOUND_EVENT_IDS` と `MINECRAFT_26_2_SOUNDS_JSON` は、26.2 の公式
`sounds.json` 全体を固定データとして提供する。従来イベントに加えて、Cinnabar、Sulfur、
Sulfur Spike、Potent Sulfur、Sulfur Cube、Small Sulfur Cube、geyser、bucket のイベントも
含む。resource pack を読み込んだ後、`missingMinecraft26_2SoundEvents` で解析済み
`sounds.json` が公式カタログ全体を持つか検査できる。

```ts
import {
  missingMinecraft26_2SoundEvents,
  parseMinecraftSoundsJson,
} from '@nerima-games/mc-audio'

const registry = parseMinecraftSoundsJson(resourcePackSoundsJson, {
  namespace: 'minecraft',
})
const missing = missingMinecraft26_2SoundEvents(registry)
```

このカタログは識別子と検証だけを提供し、Mojang の OGG ファイルは再配布しない。音源は
権利を持つ resource pack から通常の `sounds.json` / asset-loading 境界を通して渡す。
イベント一覧は [Java Edition 26.2 のリリースノート](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-2)
と [26.2 の sounds.json](https://mcasset.cloud/26.2/assets/minecraft/sounds.json) に基づく。

定義本体も `MINECRAFT_26_2_SOUNDS_JSON` と `createMinecraft26_2SoundRegistry()` で利用できる。
これは公式 `sounds.json` 全イベントについて、候補音、subtitle、weight、volume、pitch、
`stream` などのメタデータを保持した固定データである。空の variant 配列を持つ公式イベントも
識別子を維持したまま収録し、実際に解決・再生する段階で空イベントとして扱う。

同梱 JSON は `pnpm import:minecraft-sounds` で公式 URL から再生成できる。生成後のデータは
parser の境界検証と公式カタログの回帰テストを通過させる。

```ts
import {
  createMinecraft26_2SoundRegistry,
  MINECRAFT_26_2_SOUNDS_JSON,
} from '@nerima-games/mc-audio'

const registry = createMinecraft26_2SoundRegistry()
const officialDefinition = MINECRAFT_26_2_SOUNDS_JSON['block.cinnabar.break']
```

この定義にも音声バイナリは含まれない。`minecraftSoundManifest(registry, baseUrl)` または
ホストが用意した `AudioSampleManifest` と組み合わせて再生する。

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
  moodPosition: resolvedMoodPosition,
  randomSource: gameRandom,
  state: initialMinecraftAmbientSoundsState(),
  tick,
})
```

`moodPosition` は camera/world 側が `block_search_extent`、`offset`、周囲の暗さを使って
解決して渡す。音声ライブラリは world/block の検索や光量計算を行わないため、
`mc-kernel` の `Position` をそのまま受け取り、純粋な計画関数と
`makeMinecraftAmbientSoundsPlayer` の再生経路を保つ。`moodPosition` が `null` の tick
では mood 音を再生しないが、現実装の次回判定は定義の `tick_delay` に従う。vanilla と
同じ暗所サンプリングを行うには、ホスト側の world resolver をこの入力へ接続する必要が
ある。現在の `mc-kernel` に world/light lookup port はないため、音声ライブラリ単体で
そこを推測しない。planner は mood command に `offset` を保持し、player はそれを音源との
距離へ加算して減衰だけに適用する。`randomSource` は additions の抽選に必須で、暗黙の
`Math.random` は使わない。

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

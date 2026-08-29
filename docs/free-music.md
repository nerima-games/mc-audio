# フリー音源の音楽

`createFreeMinecraftMusicPack()` は、Minecraft の音楽イベント名と再生制御に合わせた、依存のないオリジナル PCM/WAV 音源を生成する。
標準で通常・水中・クリエイティブ・Sulfur Caves、26.2 の直接対応曲 5 曲、音楽ディスク `Bounce` の計 10 トラックを提供する。
`FREE_MINECRAFT_MUSIC_EVENT_VARIANTS` には、26.2 の背景曲・エンド曲・音楽ディスクを含む全公式音楽イベントの ID、variant 順序、音源 ID、音量、weight、`stream`、`type` を公開している。
`pack.registry` は vanilla の `sounds.json` に重ねる additive overlay で、`replace: false` を使う。
vanilla registry と merge すると、既存イベントの音源を保持したままフリー音源を追加できる。
vanilla の通常曲へ代替音源を混ぜずに再生するため、通常曲と Sulfur Caves のフリー音源は専用イベント
`minecraft:music.free_game` / `minecraft:music.free_sulfur_caves` としても登録される。

```ts
import { Effect, Layer } from 'effect'
import {
  AudioBackendPort,
  createFreeMinecraftMusicPack,
  MINECRAFT_MUSIC_STARTING_DELAY_TICKS,
  makeMinecraftMusicPlayer,
  makeWebAudioBackend,
  mergeAudioSampleManifests,
  mergeMinecraftSoundRegistries,
  minecraftSoundManifest,
  parseMinecraftSoundsJson,
} from '@nerima-games/mc-audio'

const pack = createFreeMinecraftMusicPack()
// vanillaSoundsJson はホストが読み込んだ vanilla の sounds.json です。
const vanillaRegistry = parseMinecraftSoundsJson(vanillaSoundsJson, {
  namespace: 'minecraft',
})
const registry = mergeMinecraftSoundRegistries(vanillaRegistry, pack.registry)
const vanillaManifest = minecraftSoundManifest(vanillaRegistry, '/resource-pack')
const randomSource = () => 0.5
const backend = await Effect.runPromise(makeWebAudioBackend({
  global: globalThis,
  // 既存 ID は vanilla を優先し、フリー専用 ID は pack から追加する。
  sampleManifest: mergeAudioSampleManifests(vanillaManifest, pack.manifest),
}))
const player = await Effect.runPromise(
  makeMinecraftMusicPlayer(registry, randomSource).pipe(
    Effect.provide(Layer.succeed(AudioBackendPort, backend)),
  ),
)

const tickInput = {
  context: { creative: false, underwater: false },
}

async function onUserGesture(): Promise<void> {
  if (await Effect.runPromise(backend.unlock) !== 'ready') return
  for (let index = 0; index <= MINECRAFT_MUSIC_STARTING_DELAY_TICKS; index += 1) {
    await Effect.runPromise(player.tick(tickInput))
  }
}
```

`onUserGesture` はクリックなどのユーザー操作へ接続する。以後は同じ `player.tick` を
ゲーム tick ごとに呼び出す。

vanilla の曲を使わず生成音源だけを使う場合は、`backgroundMusic` の `sound` を
`minecraft:music.free_game` または `minecraft:music.free_sulfur_caves` に設定する。
公式の 26.2 音楽イベント形状は、vanilla の既存 variant を消さない additive overlay として登録できる。
`mergeAudioSampleManifests(base, additions)` も base の同一 `soundId` を優先するため、vanilla の音源を
意図せず生成音源で上書きしない。vanilla が持たない専用 ID だけが additions から追加される。

## 互換している範囲

音楽の状態機械は次の Minecraft 形式を維持する。

- `minecraft:music.*`、`minecraft:music.overworld.*`、`minecraft:music_disc.*` の 26.2 音楽イベント名と variant 配列。代替用の `minecraft:music.free_game` / `minecraft:music.free_sulfur_caves` も別イベントとして公開する
- 26.2 で追加された `music/game/shores`、`music/game/memories`、`music/game/nightly`、`music/game/home`、`music/game/ebb` の音源識別子
- 初回待ち時間 100 tick
- 通常の待ち時間 12,000〜24,000 tick
- 水中をクリエイティブより優先する環境解決
- `min_delay`、`max_delay`、`replace_current_music`
- `music_volume` の 0〜1 と、0.05 刻みのフェード
- `stream`、`preload`、`weight`、`volume`、`pitch` を含む音源 manifest / registry 境界

26.2 の公式 `sounds.json` にある全音楽イベントの配置を保持する。直接対応する `Ebb`、`Home`、`Memories`、
`Nightly`、`Shores` は対応する生成サンプルへ結び付け、その他の背景曲、エンド曲、水中曲、Nether 曲、音楽ディスクは
合法な置換用の生成サンプルへ写像する。各 variant の順序、`weight`、`volume`、`stream`、`type: event` を保持するため、
同じ重み付き選択とイベント参照を再現できる。公式 JSON で省略された値は parser と同じく `volume: 1`、`weight: 1`、
`stream: false`（event variant）として正規化する。空の Warped Forest イベントも含め、イベント ID の集合を欠落させない。

生成された sound variant は `stream: true` を持つ。ホストがストリーム生成器を提供する場合はそれを優先し、
組み込みの `ArrayBuffer` 音源やストリームをデコードできるホストでは同じ音源をデコードして再生する。
そのため、Minecraft 側の音源メタデータを維持したまま、ブラウザ実装の違いで無音にならない。

データ駆動の音声設定は `backgroundMusic` で渡せる。これは Minecraft の
`background_music` の `default`、`underwater`、`creative` に対応し、現在の環境にある定義だけを選ぶ。
`backgroundMusic: {}` または現在の環境に対応するキーがない場合は音楽を再生しない。
公式 JSON の `background_music: { default: {} }` のような空オブジェクトも、そのキーを明示的な無音として扱う。
公式コンポーネントの正規化結果である `backgroundMusic: null` は無音を表す。
プレイヤー API の `backgroundMusic` 自体を省略した場合は、組み込みの通常・水中・クリエイティブ定義へ
フォールバックする。
`musicVolume` は `music_volume` に対応する。

`replace_current_music` の既定値は `false` である。現在の音楽がまだ再生中なら、通常は曲を途中で差し替えず、音量だけを追従させる。

## 「既存 Minecraft と完全に同じ」の範囲と限界

再生制御・イベント ID・データ形式は既存 Minecraft に合わせているが、生成される 10 曲は Mojang の原曲・録音・編曲ではない。
原曲の音声バイナリを無断で再配布できないため、リポジトリには著作権付きの Minecraft 音源を同梱していない。
したがって、原曲そのものまで完全一致させるには、適法なリソースパックまたは権利者から提供された音源を別途用意する必要がある。

音源を差し替える場合は、全公式イベントの registry は保ったまま、アプリケーションが利用許諾を確認した音声の
`ArrayBuffer` を manifest に渡す。公式の音声 ID と同じ manifest key を用意すれば、生成サンプルを使わずに
イベント配置・重み・音量を保ったまま実録音源へ差し替えられる。ライブラリは音源の取得元やライセンスを決めない。

```ts
const manifest: AudioSampleManifest = {
  'minecraft:music/free_game': {
    kind: 'array-buffer',
    data: licensedAudio,
    preload: false,
    stream: true,
  },
}
```

`licensedAudio` はアプリケーション側で取得・検証した音声データである。第三者の無料音源を利用する場合も、各音源のライセンス表示と帰属条件を確認すること。

## 参照した仕様

- [Minecraft Java Edition Snapshot 25w42a: data-driven audio](https://feedback.minecraft.net/hc/en-us/articles/40320457571725-Minecraft-Java-Edition-Snapshot-25w42a)
- [Minecraft Java Edition 26.2](https://feedback.minecraft.net/hc/en-us/articles/46690753273997-Minecraft-Java-Edition-26-2)
- [Mojang version manifest](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json)（26.2 の asset index から公式 `minecraft/sounds.json` を解決）
- [NeoForged: Sounds](https://docs.neoforged.net/docs/1.21.8/resources/client/sounds/)

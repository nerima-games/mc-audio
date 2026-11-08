import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { audioAssetCredits, decodeAudioAssetManifest, type AudioAssetAttribution, type AudioAssetManifest } from '../../src/domain/audio-asset-manifest.js'
import {
  decodeMusicScenePlaylistManifest,
  musicScenePlaylistCredits,
  type MusicScenePlaylistManifest,
} from '../../src/domain/music-scene-playlist.js'
import { Result } from 'effect'

type AudioCreditsInput = {
  readonly effects: AudioAssetManifest
  readonly music: MusicScenePlaylistManifest
}

const attributionKey = (attribution: AudioAssetAttribution): string => {
  if (attribution.type === 'external') {
    return JSON.stringify([
      attribution.type,
      attribution.author,
      attribution.workTitle,
      attribution.sourceUrl,
      attribution.licenseName,
      attribution.licenseUrl,
      attribution.modified,
    ])
  }
  return JSON.stringify([
    attribution.type,
    attribution.generatorScript,
    attribution.licenseSpdx,
    attribution.licenseName,
    attribution.licenseFile,
    attribution.licenseUrl,
  ])
}

const labelFor = (attribution: AudioAssetAttribution): string =>
  attribution.type === 'external'
    ? `${attribution.author}, ${attribution.workTitle}`
    : attribution.generatorScript

const lineFor = (attribution: AudioAssetAttribution, files: ReadonlyArray<string>): string => {
  const source = attribution.type === 'external'
    ? `[${labelFor(attribution)}](${attribution.sourceUrl})`
    : `\`${attribution.generatorScript}\``
  const license = `[${attribution.licenseName}](${attribution.licenseUrl})`
  const terms = attribution.type === 'external'
    ? `${license}; modified: ${attribution.modified ? 'yes' : 'no'}`
    : `${license}; SPDX: \`${attribution.licenseSpdx}\`; license file: \`${attribution.licenseFile}\``
  const paths = [...files].sort().map((file) => `\`${file}\``).join(', ')
  return `| ${source} | ${terms} | ${paths} |`
}

export const renderAudioCredits = (input: AudioCreditsInput): string => {
  const attributions = new Map<string, AudioAssetAttribution>()
  const filesByAttribution = new Map<string, string[]>()
  const register = (attribution: AudioAssetAttribution, file: string): void => {
    const key = attributionKey(attribution)
    attributions.set(key, attribution)
    const files = filesByAttribution.get(key) ?? []
    files.push(file)
    filesByAttribution.set(key, files)
  }

  for (const credit of audioAssetCredits(input.effects)) {
    attributions.set(attributionKey(credit), credit)
  }
  for (const variants of Object.values(input.effects)) {
    for (const variant of variants ?? []) {
      register(variant.attribution, variant.file)
    }
  }
  for (const credit of musicScenePlaylistCredits(input.music)) {
    attributions.set(attributionKey(credit), credit)
  }
  for (const playlist of Object.values(input.music)) {
    for (const track of playlist?.tracks ?? []) {
      register(track.attribution, track.file)
    }
  }

  const rows = [...attributions.entries()]
    .sort((left, right) => labelFor(left[1]).localeCompare(labelFor(right[1]), 'en'))
    .map(([key, attribution]) => lineFor(attribution, filesByAttribution.get(key) ?? []))

  return [
    '# Audio credits',
    '',
    'This file is generated from the cue and music manifests.',
    '',
    '| Source | License | Files |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

const manifestAt = (path: string): URL => new URL(path, import.meta.url)

const decoded = <Value, Failure>(label: string, result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) {
    throw new Error(`${label} could not be decoded`)
  }
  return result.success
}

const readJson = async (url: URL): Promise<unknown> => JSON.parse(await readFile(url, 'utf8')) as unknown

const main = async (): Promise<void> => {
  const effects = decoded(
    'Cue manifest',
    decodeAudioAssetManifest(await readJson(manifestAt('../../audio/effects/manifest.json'))),
  )
  const music = decoded(
    'Music manifest',
    decodeMusicScenePlaylistManifest(await readJson(manifestAt('../../audio/music/manifest.json'))),
  )
  const outputUrl = manifestAt('../../audio/CREDITS.md')
  const output = renderAudioCredits({ effects, music })
  if (process.argv.includes('--check')) {
    const existing = await readFile(outputUrl, 'utf8')
    if (existing !== output) {
      throw new Error('audio/CREDITS.md does not match the manifests')
    }
    process.stdout.write('Audio credits match both manifests.\n')
    return
  }
  await writeFile(outputUrl, output)
  process.stdout.write('Wrote audio/CREDITS.md from both manifests.\n')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : 'Audio credits generation failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}

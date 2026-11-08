import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { audioAssetCredits, decodeAudioAssetManifest } from '../src/domain/audio-asset-manifest.js'
import {
  MUSIC_SCENES,
  decodeMusicScenePlaylistManifest,
  musicScenePlaylistCredits,
  musicScenePlaylistRegistry,
  musicScenePlaylistSampleManifest,
} from '../src/domain/music-scene-playlist.js'
import { SOUND_CUE_IDS } from '../src/domain/cue.js'
import { renderAudioCredits } from '../scripts/audio/generate-credits.js'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const manifestPath = (file: string): string => resolve(projectRoot, file)

type MusicMetadata = {
  readonly codec: 'Vorbis'
  readonly container: 'Ogg'
  readonly sampleRateHz: 48_000
  readonly channels: 2
  readonly seed: 482_712
  readonly normalization: {
    readonly targetDbfsRms: -18
    readonly maximumPeakDbfs: -1
  }
  readonly scenes: Readonly<Record<string, {
    readonly key: string
    readonly tempoBpm: number
    readonly durationSeconds: number
    readonly timbre: string
  }>>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isMusicMetadata = (value: unknown): value is MusicMetadata => {
  if (!isRecord(value) || !isRecord(value['normalization']) || !isRecord(value['scenes'])) {
    return false
  }

  const normalization = value['normalization']
  const scenes = value['scenes']
  return value['codec'] === 'Vorbis'
    && value['container'] === 'Ogg'
    && value['sampleRateHz'] === 48_000
    && value['channels'] === 2
    && value['seed'] === 482_712
    && normalization['targetDbfsRms'] === -18
    && normalization['maximumPeakDbfs'] === -1
    && Object.values(scenes).every((track) => isRecord(track)
      && typeof track['key'] === 'string'
      && typeof track['tempoBpm'] === 'number'
      && Number.isFinite(track['tempoBpm'])
      && typeof track['durationSeconds'] === 'number'
      && Number.isFinite(track['durationSeconds'])
      && typeof track['timbre'] === 'string')
}

const readJson = async (file: string): Promise<unknown> =>
  JSON.parse(await readFile(manifestPath(file), 'utf8'))

const audioFilesUnder = async (directory: string): Promise<ReadonlyArray<string>> => {
  const absoluteDirectory = manifestPath(directory)
  const entries = await readdir(absoluteDirectory, { withFileTypes: true })
  const nested = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => audioFilesUnder(`${directory}/${entry.name}`)))
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ogg'))
    .map((entry) => `${directory}/${entry.name}`)
  return [...files, ...nested.flat()].sort()
}

describe('distributed audio assets', () => {
  it('covers all registered cues and music scenes with decodable manifest data', async () => {
    const effectsResult = decodeAudioAssetManifest(await readJson('audio/effects/manifest.json'))
    const musicResult = decodeMusicScenePlaylistManifest(await readJson('audio/music/manifest.json'))
    expect(Result.isSuccess(effectsResult)).toBe(true)
    expect(Result.isSuccess(musicResult)).toBe(true)
    if (Result.isFailure(effectsResult) || Result.isFailure(musicResult)) {
      throw new Error('Audio distribution manifests are invalid')
    }

    const effects = effectsResult.success
    const music = musicResult.success
    expect(Object.keys(effects).sort()).toEqual(SOUND_CUE_IDS.map(String).sort())
    expect(Object.keys(music).sort()).toEqual([...MUSIC_SCENES].sort())
    expect(audioAssetCredits(effects).length).toBeGreaterThan(0)
    expect(musicScenePlaylistCredits(music).length).toBeGreaterThan(0)
    const effectVariants = Object.values(effects).flatMap((variants) => variants ?? [])
    expect(effectVariants.some((variant) => variant.attribution.type === 'external')).toBe(true)
    expect(effectVariants.some((variant) => variant.attribution.type === 'generated')).toBe(true)
    for (const variant of effectVariants) {
      if (variant.attribution.type === 'external') {
        expect(variant.attribution.licenseName).toBe('CC0 1.0 Universal')
        expect(variant.attribution.licenseUrl).toBe('https://creativecommons.org/publicdomain/zero/1.0/')
      }
    }

    const sceneRegistry = musicScenePlaylistRegistry(music)
    const musicSamples = musicScenePlaylistSampleManifest(music)
    const expectedTrackCount = Object.values(music).reduce((count, playlist) => count + (playlist?.tracks.length ?? 0), 0)
    expect(sceneRegistry.events.size).toBe(expectedTrackCount)
    expect(musicSamples.size).toBe(expectedTrackCount)

    const assetPaths = [
      ...Object.values(effects).flatMap((variants) => variants?.map((variant) => variant.file) ?? []),
      ...Object.values(music).flatMap((playlist) => playlist?.tracks.map((track) => track.file) ?? []),
    ]
    expect(assetPaths.length).toBeGreaterThan(0)
    const assetStats = await Promise.all(assetPaths.map((file) => stat(manifestPath(file))))
    for (const [index, assetStat] of assetStats.entries()) {
      expect(assetStat.isFile(), assetPaths[index]).toBe(true)
    }

    const credits = await readFile(manifestPath('audio/CREDITS.md'), 'utf8')
    expect(credits).toBe(renderAudioCredits({ effects, music }))
  })

  it('records the generation settings for every music scene', async () => {
    const input = await readJson('audio/music/metadata.json')
    expect(isMusicMetadata(input)).toBe(true)
    if (!isMusicMetadata(input)) {
      throw new Error('Music generation metadata is invalid')
    }
    const metadata = input

    expect(metadata).toMatchObject({
      codec: 'Vorbis',
      container: 'Ogg',
      sampleRateHz: 48_000,
      channels: 2,
      seed: 482_712,
      normalization: { targetDbfsRms: -18, maximumPeakDbfs: -1 },
    })
    expect(Object.keys(metadata.scenes).sort()).toEqual([...MUSIC_SCENES].sort())
    for (const [scene, track] of Object.entries(metadata.scenes)) {
      expect(track.key, scene).not.toBe('')
      expect(track.tempoBpm, scene).toBeGreaterThan(0)
      expect(track.durationSeconds, scene).toBeGreaterThanOrEqual(60)
      expect(track.durationSeconds, scene).toBeLessThanOrEqual(120)
      expect(track.timbre, scene).not.toBe('')
    }
  })

  it('matches every distributed OGG to its SHA-256 record', async () => {
    const checksumText = await readFile(manifestPath('audio/SHA256SUMS'), 'utf8')
    const checksumLines = checksumText.trim().split(/\r?\n/u)
    expect(checksumLines.length).toBeGreaterThan(0)

    const expected = new Map<string, string>()
    for (const line of checksumLines) {
      const match = /^(?<digest>[a-f\d]{64}) {2}(?<file>audio\/.+\.ogg)$/u.exec(line)
      expect(match).not.toBeNull()
      if (match) {
        expected.set(match.groups?.['file'] ?? '', match.groups?.['digest'] ?? '')
      }
    }
    expect(expected.size).toBe(checksumLines.length)

    const actualFiles = [
      ...await audioFilesUnder('audio/effects'),
      ...await audioFilesUnder('audio/music'),
    ].sort()
    expect(actualFiles.length).toBeGreaterThan(0)
    expect([...expected.keys()].sort()).toEqual(actualFiles)
    const actualDigests = await Promise.all(actualFiles.map(async (file) => {
      const bytes = await readFile(manifestPath(file))
      return [file, createHash('sha256').update(bytes).digest('hex')] as const
    }))
    for (const [file, digest] of actualDigests) {
      expect(digest, file).toBe(expected.get(file))
    }

    const effectFiles = await audioFilesUnder('audio/effects')
    const musicFiles = await audioFilesUnder('audio/music')
    const effectBytes = (await Promise.all(effectFiles.map(async (file) => (await stat(manifestPath(file))).size)))
      .reduce((total, size) => total + size, 0)
    const musicBytes = (await Promise.all(musicFiles.map(async (file) => (await stat(manifestPath(file))).size)))
      .reduce((total, size) => total + size, 0)
    expect(effectBytes).toBeLessThanOrEqual(2_000_000)
    expect(musicBytes).toBeLessThanOrEqual(10_000_000)
  })

  it('ships the asset tree in the npm package configuration', async () => {
    const packageJson = await readJson('package.json')
    expect(packageJson).toMatchObject({ files: expect.arrayContaining(['audio']) })
  })
})

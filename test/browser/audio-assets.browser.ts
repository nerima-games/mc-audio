import { Effect, Result } from 'effect'
import { expect, test } from 'vitest'
import { AudioPan, AudioSampleId } from '../../src/domain/audio-brands.js'
import { decodeAudioAssetManifest, type AudioAssetManifest } from '../../src/domain/audio-asset-manifest.js'
import { mapAudioEvent } from '../../src/domain/audio-event-map.js'
import {
  decodeMusicScenePlaylistManifest,
  musicScenePlaylistRegistry,
  musicScenePlaylistSampleManifest,
  type MusicScenePlaylistManifest,
} from '../../src/domain/music-scene-playlist.js'
import { CUE_DEFINITIONS_BY_ID } from '../../src/data/cue-definitions.js'
import { makeWebAudioBackend } from '../../src/domain/webaudio-adapter.js'

const fetchJson = async (path: string): Promise<unknown> => {
  const response = await fetch(new URL(path, `${window.location.origin}/`))
  if (!response.ok) {
    throw new Error(`Could not read ${path}: ${response.status}`)
  }
  return response.json()
}

const fetchAudio = async (path: string): Promise<ArrayBuffer> => {
  const response = await fetch(new URL(path, `${window.location.origin}/`))
  if (!response.ok) {
    throw new Error(`Could not read ${path}: ${response.status}`)
  }
  return response.arrayBuffer()
}

const decode = <Value, Failure>(label: string, result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) {
    throw new Error(`${label} manifest could not be decoded`)
  }
  return result.success
}

const soundFiles = (manifest: AudioAssetManifest): ReadonlyArray<string> =>
  Object.values(manifest).flatMap((variants) => variants?.map((variant) => variant.file) ?? [])

const musicFiles = (manifest: MusicScenePlaylistManifest): ReadonlyArray<string> =>
  Object.values(manifest).flatMap((playlist) => playlist?.tracks.map((track) => track.file) ?? [])

const rmsAndPeak = (buffer: AudioBuffer): { readonly peak: number; readonly rms: number } => {
  let sumSquares = 0
  let peak = 0
  let samples = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const values = buffer.getChannelData(channel)
    for (const sample of values) {
      sumSquares += sample * sample
      peak = Math.max(peak, Math.abs(sample))
      samples += 1
    }
  }
  return { peak, rms: Math.sqrt(sumSquares / samples) }
}

const dbfs = (rms: number): number => 20 * Math.log10(rms)

test('loads every cue through the WebAudio asset loader and decodes every scene track', async () => {
  const effects = decode(
    'Cue',
    decodeAudioAssetManifest(await fetchJson('/audio/effects/manifest.json')),
  )
  const music = decode(
    'Music',
    decodeMusicScenePlaylistManifest(await fetchJson('/audio/music/manifest.json')),
  )
  const effectVariantCount = soundFiles(effects).length
  const trackFiles = musicFiles(music)
  expect(effectVariantCount).toBeGreaterThan(0)
  expect(trackFiles).toHaveLength(9)

  const backend = await Effect.runPromise(makeWebAudioBackend({
    audioAssetManifest: effects,
    global: { AudioContext },
    loadSampleData: async (url) => fetchAudio(url),
  }))

  try {
    await expect(Effect.runPromise(backend.unlock)).resolves.toBe('ready')
    const loadReport = await Effect.runPromise(backend.preloadAudioAssets)
    expect(loadReport.requested).toBe(effectVariantCount)
    expect(loadReport.loaded).toBe(effectVariantCount)
    expect(loadReport.failed).toBe(0)
    expect(loadReport.failures).toEqual([])

    const mapping = mapAudioEvent({ kind: 'pickup' })
    expect(Result.isSuccess(mapping)).toBe(true)
    if (Result.isFailure(mapping) || mapping.success.cueId === null) {
      throw new Error('Pickup event did not map to an audio cue')
    }
    const definition = CUE_DEFINITIONS_BY_ID[mapping.success.cueId]
    if (definition === undefined) {
      throw new Error(`No cue definition for ${mapping.success.cueId}`)
    }
    const playback = await Effect.runPromise(backend.playTone({
      durationSecs: definition.durationSecs,
      frequency: definition.frequency,
      gain: definition.baseGain,
      loop: false,
      pan: AudioPan(0),
      soundId: mapping.success.cueId,
      wave: definition.wave,
    }))
    expect(playback.accepted).toBe(true)
    const backendReport = await Effect.runPromise(backend.report)
    expect(backendReport.audioAssetFailures).toEqual([])
    expect(backendReport.sampleLoadFailures).toEqual([])
  } finally {
    await Effect.runPromise(backend.dispose)
  }

  const decoder = new AudioContext()
  try {
    const effectVariants = Object.values(effects).flatMap((variants) => variants ?? [])
    const decodedEffects = await Promise.all(effectVariants.map(async (variant) => {
      const bytes = await fetchAudio(variant.file)
      const buffer = await decoder.decodeAudioData(bytes)
      return { buffer, variant }
    }))
    for (const { buffer, variant } of decodedEffects) {
      expect(buffer.duration, variant.file).toBeGreaterThan(0.05)
      expect(buffer.duration, variant.file).toBeLessThan(3)
      const { peak, rms } = rmsAndPeak(buffer)
      expect(peak, variant.file).toBeLessThan(1)
      const effectiveLevel = dbfs(rms * variant.volume)
      expect(effectiveLevel, variant.file).toBeGreaterThanOrEqual(-22)
      expect(effectiveLevel, variant.file).toBeLessThanOrEqual(-14)
    }

    const registry = musicScenePlaylistRegistry(music)
    const sampleManifest = musicScenePlaylistSampleManifest(music)
    expect(registry.events.size).toBe(trackFiles.length)
    expect(sampleManifest.size).toBe(trackFiles.length)
    const tracks = Object.values(music).flatMap((playlist) => playlist?.tracks ?? [])
    await Promise.all(tracks.map(async (track) => {
      const event = registry.events.get(track.eventId)
      expect(event, track.file).toBeDefined()
      const source = sampleManifest.get(AudioSampleId(track.file))
      expect(source, track.file).toMatchObject({ kind: 'url', stream: true, url: track.file })
      const bytes = await fetchAudio(track.file)
      const buffer = await decoder.decodeAudioData(bytes)
      expect(buffer.duration, track.file).toBeGreaterThanOrEqual(60)
      expect(buffer.duration, track.file).toBeLessThanOrEqual(120)
      const { peak, rms } = rmsAndPeak(buffer)
      expect(peak, track.file).toBeLessThan(1)
      expect(dbfs(rms), track.file).toBeGreaterThanOrEqual(-22)
      expect(dbfs(rms), track.file).toBeLessThanOrEqual(-14)
    }))
  } finally {
    await decoder.close()
  }
})

import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const MINECRAFT_VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const MINECRAFT_RESOURCES_URL = 'https://resources.download.minecraft.net'

const TARGETS = {
  '26.2': {
    label: 'Minecraft 26.2',
    versionId: '26.2',
    // A `.ts` module exporting the data as `export default {...}` rather
    // than a `.json` file imported with `with { type: 'json' }`: TypeScript's
    // declaration emit drops import attributes from the emitted `.d.ts`
    // regardless of the emitting project's `module`/`moduleResolution`,
    // which then fails to typecheck for any downstream consumer resolving
    // under NodeNext (caught by scripts/verify-package.mjs's
    // declaration-consumer check, TS1543).
    outputPath: resolve(import.meta.dirname, '../src/domain/minecraft-26-2-sounds-raw.ts'),
  },
  '26.3-snapshot-9': {
    label: 'Minecraft 26.3 Snapshot 9',
    versionId: '26.3-snapshot-9',
    outputPath: resolve(import.meta.dirname, '../src/domain/minecraft-26-3-snapshot-9-sounds-raw.ts'),
  },
} as const

const targetName = process.argv.slice(2).find((argument) => argument !== '--') ?? '26.2'
const target = TARGETS[targetName as keyof typeof TARGETS]

if (!target) {
  throw new Error(`Unknown Minecraft sounds target: ${targetName}. Supported targets: ${Object.keys(TARGETS).join(', ')}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const requiredString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`)
  }

  return value
}

const requiredInteger = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative integer`)
  }

  return value
}

const fetchJson = async (url: string, label: string): Promise<unknown> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Unable to download ${label}: ${response.status} ${response.statusText}`)
  }

  return JSON.parse(await response.text()) as unknown
}

const validateSoundsDocument = (input: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(input) || Object.keys(input).length === 0) {
    throw new TypeError(`${label} sounds.json must be a non-empty object`)
  }

  for (const [eventId, definition] of Object.entries(input)) {
    if (!isRecord(definition) || !Array.isArray(definition['sounds'])) {
      throw new TypeError(`${label} sounds.json has an invalid sounds array at ${eventId}`)
    }
  }

  return input
}

const resolveSoundAsset = async (versionId: string, label: string): Promise<{
  url: string
  sha1: string
  size: number
}> => {
  const manifest = await fetchJson(MINECRAFT_VERSION_MANIFEST_URL, 'Minecraft version manifest')
  if (!isRecord(manifest) || !Array.isArray(manifest['versions'])) {
    throw new TypeError('Minecraft version manifest must contain a versions array')
  }

  const version = manifest['versions'].find((candidate) => (
    isRecord(candidate) && candidate['id'] === versionId
  ))
  if (!isRecord(version)) {
    throw new Error(`${label} was not found in the Minecraft version manifest`)
  }

  const metadataUrl = requiredString(version['url'], `${label} version metadata URL`)
  const metadata = await fetchJson(metadataUrl, `${label} version metadata`)
  if (!isRecord(metadata) || !isRecord(metadata['assetIndex'])) {
    throw new TypeError(`${label} version metadata must contain an assetIndex object`)
  }

  const assetIndexUrl = requiredString(metadata['assetIndex']['url'], `${label} asset index URL`)
  const assetIndex = await fetchJson(assetIndexUrl, `${label} asset index`)
  if (!isRecord(assetIndex) || !isRecord(assetIndex['objects'])) {
    throw new TypeError(`${label} asset index must contain an objects object`)
  }

  const soundAsset = assetIndex['objects']['minecraft/sounds.json']
  if (!isRecord(soundAsset)) {
    throw new Error(`${label} asset index does not contain minecraft/sounds.json`)
  }

  const sha1 = requiredString(soundAsset['hash'], `${label} sounds.json hash`)
  if (!/^[a-f0-9]{40}$/u.test(sha1)) {
    throw new TypeError(`${label} sounds.json hash must be a SHA-1 digest`)
  }

  return {
    url: `${MINECRAFT_RESOURCES_URL}/${sha1.slice(0, 2)}/${sha1}`,
    sha1,
    size: requiredInteger(soundAsset['size'], `${label} sounds.json size`),
  }
}

const asset = await resolveSoundAsset(target.versionId, target.label)
const response = await fetch(asset.url)
if (!response.ok) {
  throw new Error(`Unable to download ${target.label} sounds.json: ${response.status} ${response.statusText}`)
}

const bytes = Buffer.from(await response.arrayBuffer())
if (bytes.length !== asset.size) {
  throw new Error(`${target.label} sounds.json size mismatch: expected ${asset.size}, received ${bytes.length}`)
}

const sha1 = createHash('sha1').update(bytes).digest('hex')
if (sha1 !== asset.sha1) {
  throw new Error(`${target.label} sounds.json SHA-1 mismatch: expected ${asset.sha1}, received ${sha1}`)
}

const input = validateSoundsDocument(JSON.parse(bytes.toString('utf8')) as unknown, target.label)
await writeFile(target.outputPath, `export default ${JSON.stringify(input, null, 2)}\n`, 'utf8')
process.stdout.write(
  `Imported ${Object.keys(input).length} ${target.label} sound events from ${asset.url} `
  + `(sha1 ${sha1}) to ${target.outputPath}\n`,
)

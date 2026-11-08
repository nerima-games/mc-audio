import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const generatorPath = fileURLToPath(new URL('./generate-assets.mjs', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'mc-audio-determinism-'))
const outputRoots = [join(root, 'first'), join(root, 'second')]
const seed = '482712'
const expectedCueCount = 18
const expectedMusicCount = 9
const metadataPath = 'audio/music/metadata.json'

const sorted = (values) => [...values].sort()

const assertEntries = async (directory, expectedNames, kind) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const actualNames = sorted(entries.map(({ name }) => name))
  const expected = sorted(expectedNames)
  if (JSON.stringify(actualNames) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected ${kind} in ${directory}: expected ${expected.join(', ')}, got ${actualNames.join(', ')}`)
  }
  for (const entry of entries) {
    if ((kind === 'directory' && !entry.isDirectory()) || (kind === 'file' && !entry.isFile())) {
      throw new Error(`Unexpected ${kind} entry type in ${directory}/${entry.name}`)
    }
  }
}

const runGeneration = async (outputRoot) => {
  const stdout = execFileSync(process.execPath, [
    generatorPath,
    '--output-dir',
    outputRoot,
    '--seed',
    seed,
  ], { encoding: 'utf8' })
  const outputs = stdout.split(/\r?\n/u).flatMap((line) => {
    const match = /^(?<file>audio\/(?:effects\/generated|music)\/[^\t]+\.ogg)\t(?<bytes>\d+) bytes\t/u.exec(line)
    return match?.groups === undefined ? [] : [{ bytes: Number(match.groups.bytes), file: match.groups.file }]
  })
  const cueFiles = outputs.filter(({ file }) => file.startsWith('audio/effects/generated/'))
  const musicFiles = outputs.filter(({ file }) => file.startsWith('audio/music/'))
  if (cueFiles.length !== expectedCueCount || musicFiles.length !== expectedMusicCount) {
    throw new Error(`Expected ${expectedCueCount} generated cues and ${expectedMusicCount} music tracks, got ${cueFiles.length} cues and ${musicFiles.length} tracks`)
  }
  const oggFiles = outputs.map(({ file }) => file)
  if (new Set(oggFiles).size !== oggFiles.length) {
    throw new Error('The generator reported a duplicate OGG output path')
  }

  await assertEntries(outputRoot, ['audio'], 'directory')
  await assertEntries(join(outputRoot, 'audio'), ['effects', 'music'], 'directory')
  await assertEntries(join(outputRoot, 'audio', 'effects'), ['generated'], 'directory')
  await assertEntries(
    join(outputRoot, 'audio', 'effects', 'generated'),
    cueFiles.map(({ file }) => file.slice('audio/effects/generated/'.length)),
    'file',
  )
  await assertEntries(
    join(outputRoot, 'audio', 'music'),
    [...musicFiles.map(({ file }) => file.slice('audio/music/'.length)), 'metadata.json'],
    'file',
  )

  const files = [...oggFiles, metadataPath]
  const loggedSizes = new Map(outputs.map(({ bytes, file }) => [file, bytes]))
  const fileContents = await Promise.all(files.map(async (file) => {
    const path = join(outputRoot, file)
    const { size } = await stat(path)
    const loggedSize = loggedSizes.get(file)
    if (size === 0) {
      throw new Error(`Generated file is empty: ${file}`)
    }
    if (loggedSize !== undefined && size !== loggedSize) {
      throw new Error(`Generated file size differs from the generator output for ${file}`)
    }
    return [file, await readFile(path)]
  }))
  return new Map(fileContents)
}

try {
  const first = await runGeneration(outputRoots[0])
  const second = await runGeneration(outputRoots[1])
  const firstFiles = sorted(first.keys())
  const secondFiles = sorted(second.keys())
  if (JSON.stringify(firstFiles) !== JSON.stringify(secondFiles)) {
    throw new Error('Generated file sets differ between runs')
  }
  for (const file of firstFiles) {
    const firstBytes = first.get(file)
    const secondBytes = second.get(file)
    if (firstBytes === undefined || secondBytes === undefined || !firstBytes.equals(secondBytes)) {
      throw new Error(`Audio generation differs between clean runs: ${file}`)
    }
  }

  process.stdout.write(`Compared ${expectedCueCount} generated cue OGGs, ${expectedMusicCount} BGM OGGs, and metadata byte-for-byte at seed ${seed}.\n`)
} finally {
  await rm(root, { recursive: true, force: true })
}

import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const generatorPath = fileURLToPath(new URL('./generate-assets.mjs', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'mc-audio-determinism-'))
const outputRoots = [join(root, 'first'), join(root, 'second')]
const seed = '482712'
const cases = [
  {
    name: 'entityHit cue',
    args: ['--only-cue', 'entityHit'],
    files: ['audio/effects/generated/entityHit.ogg'],
  },
  {
    name: 'title music',
    args: ['--only-scene', 'title'],
    files: ['audio/music/title.ogg', 'audio/music/metadata.json'],
  },
]

try {
  for (const outputRoot of outputRoots) {
    for (const testCase of cases) {
      execFileSync(process.execPath, [
        generatorPath,
        '--output-dir',
        outputRoot,
        '--seed',
        seed,
        ...testCase.args,
      ], { stdio: 'ignore' })
    }
  }

  const comparisons = await Promise.all(cases.flatMap((testCase) =>
    testCase.files.map(async (file) => {
      const [first, second] = await Promise.all(outputRoots.map(async (outputRoot) =>
        readFile(join(outputRoot, file))))
      return { file, first, name: testCase.name, second }
    })))
  for (const { file, first, name, second } of comparisons) {
    if (first.length === 0 || !first.equals(second)) {
      throw new Error(`Audio generation differs between runs for ${name}: ${file}`)
    }
  }

  process.stdout.write(`Audio generation is deterministic for the ${cases.map(({ name }) => name).join(' and ')} at seed ${seed}.\n`)
} finally {
  await rm(root, { recursive: true, force: true })
}

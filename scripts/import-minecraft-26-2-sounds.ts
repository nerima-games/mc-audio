import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SOURCE_URL = 'https://assets.mcasset.cloud/26.2/assets/minecraft/sounds.json'
// A `.ts` module exporting the data as `export default {...}` rather than a
// `.json` file: see the note in import-minecraft-sounds.ts.
const OUTPUT_PATH = resolve(import.meta.dirname, '../src/domain/minecraft-26-2-sounds-raw.ts')

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const response = await fetch(SOURCE_URL)
if (!response.ok) {
  throw new Error(`Unable to download Minecraft 26.2 sounds.json: ${response.status} ${response.statusText}`)
}

const input: unknown = JSON.parse(await response.text())
if (!isRecord(input) || Object.keys(input).length === 0) {
  throw new TypeError('Minecraft 26.2 sounds.json must be a non-empty object')
}

for (const [eventId, definition] of Object.entries(input)) {
  if (!isRecord(definition) || !Array.isArray(definition['sounds'])) {
    throw new TypeError(`Minecraft 26.2 sounds.json has an invalid sounds array at ${eventId}`)
  }
}

await writeFile(OUTPUT_PATH, `export default ${JSON.stringify(input, null, 2)}\n`, 'utf8')
process.stdout.write(`Imported ${Object.keys(input).length} Minecraft 26.2 sound events to ${OUTPUT_PATH}\n`)

import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast'

const repositoryRoot = resolve(import.meta.dirname, '..')
const allowedInternalPackages = new Set(['@nerima-games/mc-kernel'])
const sourceFileExtension = /\.(?:js|ts)$/u

type PackageManifest = {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

type SourceToken = {
  readonly kind: SyntaxKind
  readonly start: number
  readonly text: string
  readonly value: string
}

type SourceContent = {
  readonly file: string
  readonly source: string
  readonly tokens: ReadonlyArray<SourceToken>
}

type ImportReference = {
  readonly line: number
  readonly specifier: string
}

const readFileList = async (directory: string): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nestedFileLists = await Promise.all(entries.map(async (entry) => {
    const entryPath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      return readFileList(entryPath)
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      return [relative(repositoryRoot, entryPath)]
    }
    return []
  }))
  return nestedFileLists.flat()
}

const scanSource = (source: string): ReadonlyArray<SourceToken> => {
  const scanner = createScanner(false, LanguageVariant.Standard, source)
  const triviaKinds = new Set([
    SyntaxKind.WhitespaceTrivia,
    SyntaxKind.NewLineTrivia,
    SyntaxKind.SingleLineCommentTrivia,
    SyntaxKind.MultiLineCommentTrivia,
  ])
  const tokens: Array<SourceToken> = []

  while (true) {
    const kind = scanner.scan()
    if (kind === SyntaxKind.EndOfFile) {
      return tokens
    }
    if (!triviaKinds.has(kind)) {
      tokens.push({
        kind,
        start: scanner.getTokenStart(),
        text: scanner.getTokenText(),
        value: scanner.getTokenValue(),
      })
    }
  }
}

const getLineNumber = (source: string, position: number): number => (
  source.slice(0, position).split('\n').length
)

const sourceFiles = ['src/index.ts', ...await readFileList(resolve(repositoryRoot, 'src/domain'))].sort()
if (sourceFiles.length === 0) {
  process.stderr.write('dependency check found no source files\n')
  process.exitCode = 1
}

const sourceFileSet = new Set(sourceFiles)
const packageManifest = JSON.parse(
  await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
) as PackageManifest
const declaredRuntimeDependencies = new Set([
  ...Object.keys(packageManifest.dependencies ?? {}),
  ...Object.keys(packageManifest.optionalDependencies ?? {}),
  ...Object.keys(packageManifest.peerDependencies ?? {}),
])

const sourceContents = await Promise.all(sourceFiles.map(async (file): Promise<SourceContent> => {
  const source = await readFile(resolve(repositoryRoot, file), 'utf8')
  return { file, source, tokens: scanSource(source) }
}))

const collectImportReferences = (
  source: string,
  tokens: ReadonlyArray<SourceToken>,
): ReadonlyArray<ImportReference> => {
  const references: Array<ImportReference> = []
  const addReference = (token: SourceToken): void => {
    references.push({
      line: getLineNumber(source, token.start),
      specifier: token.value,
    })
  }
  const isStringLiteral = (token: SourceToken | undefined): token is SourceToken => (
    token?.kind === SyntaxKind.StringLiteral
  )

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const nextToken = tokens[index + 1]
    if (token === undefined) {
      continue
    }
    const dynamicImportToken = tokens[index + 2]
    if (
      token.text === 'import'
      && nextToken?.text === '('
      && isStringLiteral(dynamicImportToken)
    ) {
      addReference(dynamicImportToken)
      continue
    }
    if (
      token.text === 'import'
      && isStringLiteral(nextToken)
    ) {
      addReference(nextToken)
      continue
    }
    if (
      token.text === 'from'
      && isStringLiteral(nextToken)
    ) {
      addReference(nextToken)
    }
  }
  return references
}

const resolveSourceImport = (file: string, specifier: string): string | undefined => {
  if (!specifier.startsWith('.')) {
    return undefined
  }
  const importedPath = `${specifier.replace(sourceFileExtension, '')}.ts`
  const importedFile = relative(repositoryRoot, resolve(repositoryRoot, dirname(file), importedPath))
  return sourceFileSet.has(importedFile) ? importedFile : undefined
}

const importGraph = new Map<string, ReadonlyArray<string>>()
const violations: Array<string> = []

for (const { file, source, tokens } of sourceContents) {
  const references = collectImportReferences(source, tokens)
  const relativeImports = references
    .map(({ specifier }) => resolveSourceImport(file, specifier))
    .filter((importedFile): importedFile is string => importedFile !== undefined)
  importGraph.set(file, relativeImports)

  for (const { line, specifier } of references) {
    if (!specifier.startsWith('@nerima-games/')) {
      continue
    }
    const packageName = specifier.split('/').slice(0, 2).join('/')
    if (!allowedInternalPackages.has(packageName)) {
      violations.push(`${file}:${line}: forbidden internal dependency ${packageName}`)
      continue
    }
    if (!declaredRuntimeDependencies.has(packageName)) {
      violations.push(`${file}:${line}: internal dependency ${packageName} is not declared for runtime use`)
    }
  }
}

const visitedFiles = new Set<string>()
const cycles: Array<ReadonlyArray<string>> = []

const visitForCycles = (file: string, path: ReadonlyArray<string>): void => {
  const cycleStart = path.indexOf(file)
  if (cycleStart >= 0) {
    cycles.push([...path.slice(cycleStart), file])
    return
  }
  if (visitedFiles.has(file)) {
    return
  }
  const nextPath = [...path, file]
  for (const importedFile of importGraph.get(file) ?? []) {
    visitForCycles(importedFile, nextPath)
  }
  visitedFiles.add(file)
}

for (const file of sourceFiles) {
  visitForCycles(file, [])
}

for (const cycle of cycles) {
  violations.push(`circular source dependency: ${cycle.join(' -> ')}`)
}

const forbiddenClockReferences = [
  { name: 'Date.now()', sequence: ['Date', '.', 'now', '('] },
  { name: 'new Date()', sequence: ['new', 'Date', '('] },
  { name: 'performance.now()', sequence: ['performance', '.', 'now', '('] },
] as const

for (const { file, source, tokens } of sourceContents) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined) {
      continue
    }
    for (const reference of forbiddenClockReferences) {
      const matches = reference.sequence.every((text, offset) => (
        tokens[index + offset]?.text === text
      ))
      if (matches) {
        const line = getLineNumber(source, token.start)
        violations.push(`${file}:${line}: direct wall-clock access ${reference.name} is forbidden`)
      }
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    process.stderr.write(`${violation}\n`)
  }
  process.exitCode = 1
}

/**
 * The proof that `domain/webaudio-surface.ts` describes the real Web Audio API.
 *
 * ---------------------------------------------------------------------------
 * Two halves, and neither is worth anything without the other
 * ---------------------------------------------------------------------------
 *
 * `domain/webaudio-surface.ts` makes a claim that the ordinary `pnpm typecheck`
 * is structurally incapable of checking: that a REAL `AudioContext` satisfies
 * the adapter's hand-written structural types without a cast. That project has
 * no `lib.DOM`, so there is no real `AudioContext` for it to be checked
 * against — every one of those types would compile just as happily if it
 * described nothing that exists.
 *
 *   HALF ONE (`the surface describes the real API`): compile
 *   `test/fixtures/webaudio-surface.ts` — which assigns real DOM values to the
 *   surface types in both directions — against the real `lib.dom.d.ts`, and
 *   demand zero diagnostics.
 *
 *   HALF TWO (`the shipped project still compiles with NO DOM at all`): assert
 *   that `tsconfig.build.json` still has `lib: ["ES2024"]` and `types: []`,
 *   WITH the adapter inside it. This is the load-bearing half. If a later change
 *   adds `"DOM"` there, every module in `domain/` silently becomes able to reach
 *   `window`, `document` and `localStorage`, the whole suite still passes, and
 *   the reason `docs/testing.md` §2 can say "61 tests run in Node with no jsdom"
 *   is gone with nothing going red.
 *
 * Half one alone would let somebody add `"DOM"` and delete the surface. Half
 * two alone would let the surface drift into describing an API no browser has.
 *
 * ---------------------------------------------------------------------------
 * This is not a hypothetical: the fixture has already caught two mistakes
 * ---------------------------------------------------------------------------
 *
 * Both are recorded in the headers of the two files, and both would have
 * shipped:
 *
 *   1. `AudioContextState` has a FOURTH member, `'interrupted'`, which iOS
 *      Safari uses when a phone call takes the audio session. An adapter that
 *      had never heard of it reports an interrupted session as `ready` and
 *      labels its captions `audible` for sound nobody can hear — precisely the
 *      failure `docs/design-notes.md` DN-1 exists to prevent.
 *   2. `AudioNode.connect` cannot be spelled as a contravariant property
 *      without describing all of `AudioNode`. It is a method, and the surface
 *      header states what that bivariance costs instead of hiding it.
 *
 * Copied in mechanism from mc-save's `test/indexeddb-storage.test.ts`, which is
 * where this pattern in the organisation started.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('the narrow Web Audio surface', () => {
  it.effect(
    'a real AudioContext satisfies it, with no cast, against the real lib.dom.d.ts',
    () =>
      Effect.sync(() => {
        const fixture = path.join(repositoryRoot, 'test', 'fixtures', 'webaudio-surface.ts')
        const program = ts.createProgram({
          rootNames: [fixture],
          options: {
            noEmit: true,
            strict: true,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            moduleDetection: ts.ModuleDetectionKind.Force,
            skipLibCheck: true,
            types: [],
            // THE POINT OF THE TEST: the real thing, not a hand-written stub.
            lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
          },
        })

        const diagnostics = [
          ...program.getSemanticDiagnostics(),
          ...program.getSyntacticDiagnostics(),
        ].filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)

        expect(
          diagnostics.map((diagnostic) =>
            ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
          ),
        ).toStrictEqual([])
      }),
    30_000,
  )

  it.effect('the shipped project still compiles with NO DOM at all', () =>
    Effect.sync(() => {
      // The other half of the proof, and the load-bearing one. See the header.
      const config = ts.readConfigFile(
        path.join(repositoryRoot, 'tsconfig.build.json'),
        ts.sys.readFile,
      )
      const parsed = ts.parseJsonConfigFileContent(config.config as unknown, ts.sys, repositoryRoot)

      expect(parsed.options.lib).toStrictEqual(['lib.es2024.d.ts'])
      expect(parsed.options.types).toStrictEqual([])

      // ...and the adapter really is inside that project, so the two claims are
      // about the same code. Without this, the `lib` assertion above could stay
      // green while the adapter was quietly moved to a project that does have
      // DOM — which is the arrangement `domain/webaudio-surface.ts` rejects, on
      // the ground that `pnpm api:check` and `pnpm check:deps` both scan
      // exactly this project.
      const shipped = [
        'src/domain/webaudio-adapter.ts',
        'src/domain/webaudio-surface.ts',
        'src/domain/envelope.ts',
      ]
      for (const file of shipped) {
        expect(parsed.fileNames.some((name) => name.endsWith(file))).toBe(true)
      }

      // The fixture must NOT be in it: it names DOM types on purpose.
      expect(parsed.fileNames.some((name) => name.includes('/test/fixtures/'))).toBe(false)
    }),
  )

  it.effect('the fixture is excluded from every project that has no DOM', () =>
    Effect.sync(() => {
      // `tsconfig.json` is what an editor and the language server resolve
      // against, and `tsconfig.test.json` is a CI gate. The fixture compiles
      // only under DOM, so its presence in either would make `pnpm typecheck`
      // fail — and the tempting fix for THAT is to add "DOM" to the base
      // config, which is the one move this whole arrangement exists to prevent.
      for (const project of ['tsconfig.json', 'tsconfig.test.json', 'tsconfig.preview.json']) {
        const config = ts.readConfigFile(path.join(repositoryRoot, project), ts.sys.readFile)
        const parsed = ts.parseJsonConfigFileContent(
          config.config as unknown,
          ts.sys,
          repositoryRoot,
        )
        expect({
          project,
          hasFixture: parsed.fileNames.some((name) => name.includes('/test/fixtures/')),
        }).toStrictEqual({ project, hasFixture: false })
      }
    }),
  )
})

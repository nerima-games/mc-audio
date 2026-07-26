import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  allowedDirectDependencies,
  checkDeclaredDependencies,
  checkPolicyConfiguration,
  classifyImport,
  findBannedTimeSources,
  findTransitivePath,
  REPOSITORY_POLICY,
  TIME_SOURCE_ESCAPE_HATCH,
  type DeclaredDependencies,
} from '../scripts/check-dependency-whitelist'

const THIS_PACKAGE = '@nerima-games/mc-audio'

const declared = (
  dependencies: ReadonlyArray<string>,
  devDependencies: ReadonlyArray<string> = [],
): DeclaredDependencies => ({
  dependencies: new Set(dependencies),
  devDependencies: new Set(devDependencies),
})

const shippedSite = (importedPackage: string) => ({
  importedPackage,
  filePath: 'domain/thing.ts',
  line: 1,
  isToolingOrTest: false,
})

describe('mc-audio dependency policy', () => {
  it.effect('is this package, and allows no direct org dependency beyond kernel', () =>
    Effect.sync(() => {
      expect(REPOSITORY_POLICY.thisPackage).toBe(THIS_PACKAGE)
      expect([...allowedDirectDependencies()]).toStrictEqual([])
    }),
  )

  it.effect('has an internally consistent, acyclic configuration', () =>
    Effect.sync(() => {
      expect(checkPolicyConfiguration()).toStrictEqual([])
    }),
  )
})

describe('the 16-repository roster of plan.md §2.1', () => {
  it.effect('records every repository, so cycle detection sees the whole graph', () =>
    Effect.sync(() => {
      expect([...REPOSITORY_POLICY.dependencyGraph.keys()].sort()).toStrictEqual([
        '@nerima-games/mc-audio',
        '@nerima-games/mc-compose',
        '@nerima-games/mc-dev-meta',
        '@nerima-games/mc-kernel',
        '@nerima-games/mc-meshing',
        '@nerima-games/mc-noise',
        '@nerima-games/mc-physics',
        '@nerima-games/mc-playground-kit',
        '@nerima-games/mc-render',
        '@nerima-games/mc-save',
        '@nerima-games/mc-sim',
        '@nerima-games/mc-worldgen',
        '@nerima-games/mx-gameplay',
        '@nerima-games/mx-multiplayer',
        '@nerima-games/mx-redstone',
        '@nerima-games/mx-ui',
      ])
    }),
  )

  it.effect('never names kernel in a row, because kernel is universally importable', () =>
    Effect.sync(() => {
      for (const [, targets] of REPOSITORY_POLICY.dependencyGraph) {
        expect(targets.has('@nerima-games/mc-kernel')).toBe(false)
      }
      // Kernel still has a row of its own — an empty one. Without it, the
      // `checkPolicyConfiguration` rule that every edge target must be a known
      // node could not distinguish "kernel" from "typo".
      expect(REPOSITORY_POLICY.dependencyGraph.get('@nerima-games/mc-kernel')?.size).toBe(0)
    }),
  )

  it.effect('keeps the experience tier free of edges between its own members (plan.md §2.3-1)', () =>
    Effect.sync(() => {
      const experience = [
        '@nerima-games/mx-gameplay',
        '@nerima-games/mx-redstone',
        '@nerima-games/mx-ui',
        '@nerima-games/mx-multiplayer',
      ]

      for (const module of experience) {
        const targets = REPOSITORY_POLICY.dependencyGraph.get(module) ?? new Set<string>()
        for (const other of experience) {
          expect(targets.has(other)).toBe(false)
        }
      }
    }),
  )

  it.effect('gives mc-playground-kit no incoming runtime edge (plan.md §2.3-2)', () =>
    Effect.sync(() => {
      for (const [, targets] of REPOSITORY_POLICY.dependencyGraph) {
        expect(targets.has('@nerima-games/mc-playground-kit')).toBe(false)
      }
    }),
  )

  it.effect('records the graph mc-audio sits under, even though mc-audio depends on none of it', () =>
    Effect.sync(() => {
      // mc-audio is a leaf, but two experience modules depend on it. Losing
      // those rows would make a future cycle through mc-audio invisible here.
      const dependents = [...REPOSITORY_POLICY.dependencyGraph.entries()]
        .filter(([, targets]) => targets.has(THIS_PACKAGE))
        .map(([source]) => source)
        .sort()

      expect(dependents).toStrictEqual(['@nerima-games/mx-gameplay', '@nerima-games/mx-ui'])
    }),
  )
})

describe('import gate', () => {
  it.effect('allows kernel without it appearing in any allowlist, provided package.json declares it', () =>
    Effect.sync(() => {
      expect(classifyImport(shippedSite('@nerima-games/mc-kernel'), declared(['@nerima-games/mc-kernel']))).toBeUndefined()
    }),
  )

  it.effect('rejects kernel when package.json does not declare it — the exemption is policy, not packaging', () =>
    Effect.sync(() => {
      const violation = classifyImport(shippedSite('@nerima-games/mc-kernel'), declared([]))
      expect(violation?.rule).toBe('undeclared-dependency')
    }),
  )

  it.effect('rejects mc-sim, which mc-audio must never reach back into', () =>
    Effect.sync(() => {
      // mc-audio is a sink. Importing mc-sim to ask "where is the player" would
      // invert the dependency and drag a DOM-free library into the simulation.
      const violation = classifyImport(shippedSite('@nerima-games/mc-sim'), declared(['@nerima-games/mc-sim']))
      expect(violation?.rule).toBe('not-whitelisted')
    }),
  )

  /**
   * REGRESSION: no transitive closure (rule 3).
   *
   * Checked from mc-compose's row rather than mc-audio's, because mc-audio has
   * no dependencies of its own and so cannot demonstrate the rule.
   */
  it.effect('finds the transitive path that makes reaching through a dependency a violation', () =>
    Effect.sync(() => {
      const path = findTransitivePath(
        REPOSITORY_POLICY.dependencyGraph,
        '@nerima-games/mc-compose',
        '@nerima-games/mc-audio',
      )

      expect(path).toBeDefined()
      expect(path?.[0]).toBe('@nerima-games/mc-compose')
      expect(path?.[path.length - 1]).toBe('@nerima-games/mc-audio')
      // compose reaches audio only through an experience module, so the path is
      // at least three nodes long — and every hop on it is a hop compose is
      // forbidden to shortcut.
      expect((path ?? []).length).toBeGreaterThanOrEqual(3)
    }),
  )

  /**
   * The `transitive-import` branch itself, exercised from mc-render's seat.
   *
   * From mc-audio's own seat this rule is unreachable: it has no org dependencies
   * at all, so every foreign import is `not-whitelisted` instead. Borrowing
   * another repository's `thisPackage` — which is what `PolicyView` is for — is
   * the only way to run the most important rule in the gate rather than merely
   * declaring it.
   */
  it.effect('reports a transitive-closure violation, with the path, when viewed from mc-render', () =>
    Effect.sync(() => {
      const asRender = { ...REPOSITORY_POLICY, thisPackage: '@nerima-games/mc-render' }

      const violation = classifyImport(
        shippedSite('@nerima-games/mc-save'),
        declared(['@nerima-games/mc-save']),
        asRender,
      )

      expect(violation?.rule).toBe('transitive-import')
      expect(violation?.message).toContain('->')
      expect(violation?.message).toContain('not an import licence')
    }),
  )

  it.effect('still allows mc-render its own direct dependencies, so the view is not a blanket denial', () =>
    Effect.sync(() => {
      const asRender = { ...REPOSITORY_POLICY, thisPackage: '@nerima-games/mc-render' }

      expect(
        classifyImport(shippedSite('@nerima-games/mc-worldgen'), declared(['@nerima-games/mc-worldgen']), asRender),
      ).toBeUndefined()
    }),
  )

  it.effect('rejects mc-playground-kit in dependencies outright (plan.md §2.3-2)', () =>
    Effect.sync(() => {
      const violations = checkDeclaredDependencies(declared(['@nerima-games/mc-playground-kit']))

      expect(violations).toHaveLength(1)
      expect(violations[0]?.rule).toBe('dev-only-package-in-dependencies')
      expect(violations[0]?.message).toContain('devDependencies')
    }),
  )

  it.effect('accepts mc-playground-kit in devDependencies', () =>
    Effect.sync(() => {
      expect(checkDeclaredDependencies(declared([], ['@nerima-games/mc-playground-kit']))).toStrictEqual([])
    }),
  )

  it.effect('rejects importing mc-playground-kit from shipped source', () =>
    Effect.sync(() => {
      const violation = classifyImport(
        shippedSite('@nerima-games/mc-playground-kit'),
        declared([], ['@nerima-games/mc-playground-kit']),
      )
      expect(violation?.rule).toBe('dev-only-package-in-shipped-source')
    }),
  )
})

describe('time-source ban', () => {
  it.effect('flags Date.now(), new Date() and performance.now()', () =>
    Effect.sync(() => {
      const violations = findBannedTimeSources(
        ['const a = Date.now()', 'const b = new Date()', 'const c = performance.now()'].join('\n'),
        'domain/thing.ts',
      )

      expect(violations.map((violation) => violation.line).sort()).toStrictEqual([1, 2, 3])
      for (const violation of violations) {
        expect(violation.rule).toBe('banned-time-source')
      }
    }),
  )

  it.effect('ignores a clock read that only appears inside a comment or a string', () =>
    Effect.sync(() => {
      expect(
        findBannedTimeSources(['// do not call Date.now() here', 'const s = "Date.now()"'].join('\n'), 'domain/x.ts'),
      ).toStrictEqual([])
    }),
  )

  /**
   * The escape hatch matters specifically for this repository.
   *
   * A WebAudio adapter schedules against `AudioContext.currentTime`, and a
   * caption expiry needs a monotonic reading. The reference implementation's
   * audio layer contained zero raw clock reads — it scheduled from
   * `context.currentTime` (`packages/game/infrastructure/audio-engine.ts:104`)
   * and drove cue cadence from accumulated `deltaTime`
   * (`.../weather-sound.ts:19-33`). mc-audio keeps that property: `nowSecs` is
   * injected, and the hatch exists only for the eventual WebAudio adapter.
   */
  it.effect('exempts a line carrying the escape-hatch marker', () =>
    Effect.sync(() => {
      expect(
        findBannedTimeSources(`const now = Date.now() // ${TIME_SOURCE_ESCAPE_HATCH}`, 'domain/adapter.ts'),
      ).toStrictEqual([])
    }),
  )
})

import { defineConfig } from 'vitest/config'

const config: ReturnType<typeof defineConfig> = defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    maxWorkers: '50%',
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.git/**'],
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    slowTestThreshold: 300,
    fileParallelism: true,
    sequence: {
      seed: 0,
      hooks: 'stack',
    },
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      enabled: false,
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.config.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        // PURE_TYPE: declarations only, zero executable statements. v8 reports
        // such a file as 0% rather than 100%, which would make the headline
        // number meaningless. Structural contracts are enforced by
        // `pnpm typecheck` and, for webaudio-surface.ts, by
        // test/webaudio-surface.test.ts compiling it against the real
        // `lib.dom.d.ts`.
        'src/domain/minecraft-sounds-types.ts',
        'src/domain/webaudio-backend-types.ts',
        'src/domain/webaudio-surface.ts',
      ],
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
  esbuild: {
    target: 'node24',
    format: 'esm',
    platform: 'node',
  },
})

export default config

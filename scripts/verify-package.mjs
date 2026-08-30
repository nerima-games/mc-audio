/* oxlint-disable no-console -- this is a CLI verification script; printing what it verified is its purpose. */
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const packageName = manifest.name;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const typeScriptCompiler = join(
  root,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

const commandLabel = (command, args) => `${command} ${args.join(" ")}`;

const run = (
  command,
  args,
  { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, ...options } = {},
) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    timeout: timeoutMs,
    killSignal: "SIGTERM",
    ...options,
  });
  if (result.error) {
    throw new Error(
      `${commandLabel(command, args)} failed: ${result.error.message}`,
    );
  }
  if (result.signal) {
    throw new Error(
      `${commandLabel(command, args)} terminated by ${result.signal}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${commandLabel(command, args)} exited with status ${result.status}`,
    );
  }
  return result;
};

const capture = (
  command,
  args,
  { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, ...options } = {},
) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGTERM",
    ...options,
  });
  if (result.error) {
    throw new Error(
      `${commandLabel(command, args)} failed: ${result.error.message}`,
    );
  }
  if (result.signal) {
    throw new Error(
      `${commandLabel(command, args)} terminated by ${result.signal}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${commandLabel(command, args)} exited with status ${result.status}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
};

const exportEntries = Object.entries(manifest.exports ?? {});
if (exportEntries.length === 0) {
  throw new Error("package.json must declare at least one export");
}

// §2.3: a `./domain/*` subpath exists only for a module docs/public-api.md
// declares as public contract — NOT one for every module src/index.ts
// happens to re-export. mc-audio's docs/public-api.md declares none (the
// contract is the flattened root export; test/public-api.test.ts snapshots
// it), so `exports` keeps only ".". This check therefore verifies that
// whatever `./domain/*` subpaths ARE declared are real (backed by an actual
// src/index.ts re-export and pointed at the right dist path) — it does not
// require completeness in the other direction.
const sourceIndex = await readFile(join(root, "src/index.ts"), "utf8");
const starDomainEntryPoints = [
  ...sourceIndex.matchAll(
    /^\s*export \* from ['"]\.\/domain\/(?<entryPoint>[^'"]+)\.js['"]\s*;?\s*$/gm,
  ),
].map((match) => match.groups.entryPoint);
// A module re-exported by name is as public as one re-exported wholesale; the
// named form is what a module uses when a star export would collide, and it
// legitimately appears twice when values and types are listed separately.
const namedDomainEntryPoints = [
  ...sourceIndex.matchAll(
    /^\s*\}\s*from ['"]\.\/domain\/(?<entryPoint>[^'"]+)\.js['"]\s*;?\s*$/gm,
  ),
].map((match) => match.groups.entryPoint);
if (starDomainEntryPoints.length === 0) {
  throw new Error("src/index.ts must declare at least one domain entrypoint");
}
if (new Set(starDomainEntryPoints).size !== starDomainEntryPoints.length) {
  throw new Error("src/index.ts contains duplicate domain entrypoints");
}
const sourceDomainEntryPoints = [
  ...new Set([...starDomainEntryPoints, ...namedDomainEntryPoints]),
];

const declaredDomainEntryPoints = exportEntries
  .map(([subpath]) => subpath.match(/^\.\/domain\/(?<entryPoint>.+)$/)?.groups?.entryPoint)
  .filter((entryPoint) => entryPoint !== undefined);
if (
  new Set(declaredDomainEntryPoints).size !== declaredDomainEntryPoints.length
) {
  throw new Error("package.json contains duplicate domain export subpaths");
}
const undeclaredDomainEntryPoints = declaredDomainEntryPoints.filter(
  (entryPoint) => !sourceDomainEntryPoints.includes(entryPoint),
);
if (undeclaredDomainEntryPoints.length > 0) {
  throw new Error(
    `package.json declares domain export subpaths with no matching src/index.ts re-export: ${undeclaredDomainEntryPoints.join(", ")}`,
  );
}

for (const entryPoint of declaredDomainEntryPoints) {
  const subpath = `./domain/${entryPoint}`;
  const target = manifest.exports[subpath];
  const expectedTargets = {
    types: `./dist/domain/${entryPoint}.d.ts`,
    import: `./dist/domain/${entryPoint}.js`,
    default: `./dist/domain/${entryPoint}.js`,
  };
  if (typeof target !== "object" || target === null) {
    throw new Error(`Domain export ${subpath} must use conditional targets`);
  }
  for (const [field, expectedTarget] of Object.entries(expectedTargets)) {
    if (target[field] !== expectedTarget) {
      throw new Error(
        `Domain export ${subpath}.${field} must target ${expectedTarget}`,
      );
    }
  }
}

const targetPaths = new Set();
for (const [subpath, target] of exportEntries) {
  if (typeof target === "string") {
    targetPaths.add(target);
    continue;
  }
  if (typeof target !== "object" || target === null) {
    throw new Error(`Unsupported export declaration for ${subpath}`);
  }
  for (const field of ["types", "import", "default"]) {
    if (typeof target[field] === "string") {
      targetPaths.add(target[field]);
    }
  }
}

if (targetPaths.size === 0) {
  throw new Error("package.json exports do not contain any target paths");
}

const archiveEntryFor = (targetPath) =>
  `package/${targetPath.replace(/^\.\//, "")}`;
const importSpecifiers = exportEntries.map(([subpath]) =>
  subpath === "." ? packageName : `${packageName}${subpath.slice(1)}`,
);
// Domain modules whose entire declared surface is types: importing them at
// runtime yields an empty module object, which is correct rather than a sign
// of a broken export — but only relevant for entries that are actually
// declared as their own `./domain/*` subpath in package.json. mc-audio
// declares none (see the note above `declaredDomainEntryPoints`), so this
// stays empty; `webaudio-surface` is type-only in exactly this sense, but it
// is reached only through the root export, which does have runtime exports.
const typeOnlyDomainEntryPoints = new Set(
  declaredDomainEntryPoints.filter((entryPoint) => entryPoint === "webaudio-surface"),
);
for (const entryPoint of typeOnlyDomainEntryPoints) {
  if (!sourceDomainEntryPoints.includes(entryPoint)) {
    throw new Error(
      `Type-only domain entry point ${entryPoint} is not public in src/index.ts`,
    );
  }
}
const typeOnlySpecifiers = new Set(
  [...typeOnlyDomainEntryPoints].map(
    (entryPoint) => `${packageName}/domain/${entryPoint}`,
  ),
);
const rootSpecifierIndex = importSpecifiers.indexOf(packageName);
if (rootSpecifierIndex === -1) {
  throw new Error(`Package exports must include the root entry ${packageName}`);
}
const typeConsumerSubpathImports = importSpecifiers
  .map(
    (specifier, index) =>
      `import * as packageExport${index} from ${JSON.stringify(specifier)}`,
  )
  .join("\n");
const typeConsumerSubpathUses = importSpecifiers
  .map((_, index) => `  packageExport${index}`)
  .join(",\n");
const peerDependencies = manifest.peerDependencies ?? {};

const workspace = await mkdtemp(join(tmpdir(), "mc-audio-package-"));
const packDirectory = join(workspace, "pack");
const consumerDirectory = join(workspace, "consumer");
await mkdir(packDirectory);
await mkdir(consumerDirectory);

try {
  run("pnpm", ["pack", "--pack-destination", packDirectory], {
    timeoutMs: 60_000,
  });

  const archives = (await readdir(packDirectory)).filter((entry) =>
    entry.endsWith(".tgz"),
  );
  if (archives.length !== 1) {
    throw new Error(
      `Expected exactly one package archive, found ${archives.length}`,
    );
  }

  const archivePath = join(packDirectory, archives[0]);
  const archiveStat = await stat(archivePath);
  if (archiveStat.size === 0) {
    throw new Error("Package archive is empty");
  }

  const archiveEntries = new Set(
    capture("tar", ["-tzf", archivePath], { cwd: root, timeoutMs: 30_000 })
      .trim()
      .split("\n")
      .filter(Boolean),
  );
  for (const targetPath of targetPaths) {
    const archiveEntry = archiveEntryFor(targetPath);
    if (!archiveEntries.has(archiveEntry)) {
      throw new Error(
        `Package archive is missing export target ${archiveEntry}`,
      );
    }
  }

  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "mc-audio-package-consumer",
        private: true,
        type: "module",
        dependencies: {
          ...peerDependencies,
          // The published tarball itself declares @nerima-games/mc-kernel as
          // a runtime dependency (unlike kernel, which has none), so `npm
          // install <tarball>` here also resolves THAT dependency — and
          // without a registry mapping for the scope, npm falls back to
          // npmjs.com and 404s. The .npmrc written below supplies the
          // mapping (same as the repository root's .npmrc).
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumerDirectory, ".npmrc"),
    `@nerima-games:registry=https://npm.pkg.github.com\n${
      process.env["NODE_AUTH_TOKEN"] !== undefined && process.env["NODE_AUTH_TOKEN"] !== ""
        ? `//npm.pkg.github.com/:_authToken=${process.env["NODE_AUTH_TOKEN"]}\n`
        : ""
    }`,
  );
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", archivePath],
    {
      cwd: consumerDirectory,
      timeoutMs: 180_000,
    },
  );

  // Runtime probe: every declared export module must have runtime exports
  // (except the type-only ones above), and the root module's actual
  // published surface — cue lookup, volume gain arithmetic, and audio-sample
  // manifest merging — must behave exactly as the domain implements it.
  const probe = `
    const packageName = ${JSON.stringify(packageName)};
    const specifiers = ${JSON.stringify(importSpecifiers)};
    const typeOnlySpecifiers = ${JSON.stringify([...typeOnlySpecifiers])};
    const modules = await Promise.all(specifiers.map((specifier) => import(specifier)));
    if (
      modules.some(
        (module, index) =>
          !typeOnlySpecifiers.includes(specifiers[index]) && Object.keys(module).length === 0,
      )
    ) {
      throw new Error('An exported package module has no runtime exports');
    }
    const rootModule = modules[${rootSpecifierIndex}];
    if (
      typeof rootModule.isSoundCueId !== 'function' ||
      typeof rootModule.cueDefinition !== 'function' ||
      !Array.isArray(rootModule.SOUND_CUE_IDS) ||
      rootModule.SOUND_CUE_IDS.length === 0
    ) {
      throw new Error('The root export does not expose the sound cue registry');
    }
    if (!rootModule.isSoundCueId('blockBreak') || rootModule.isSoundCueId('not-a-real-cue')) {
      throw new Error('The root export returned an invalid isSoundCueId result');
    }
    const blockBreakDefinition = rootModule.cueDefinition('blockBreak');
    if (typeof blockBreakDefinition.baseGain !== 'number' || typeof blockBreakDefinition.spatial !== 'boolean') {
      throw new Error('The root export returned an invalid cue definition');
    }
    if (
      typeof rootModule.clamp01 !== 'function' ||
      typeof rootModule.clampNonNegative !== 'function' ||
      typeof rootModule.clampPan !== 'function' ||
      !Array.isArray(rootModule.VOLUME_CATEGORIES) ||
      typeof rootModule.DEFAULT_VOLUME_SETTINGS !== 'object'
    ) {
      throw new Error('The root export does not expose the volume gain APIs');
    }
    if (rootModule.clamp01(1.5) !== 1 || rootModule.clamp01(-1) !== 0 || rootModule.clamp01(0.4) !== 0.4) {
      throw new Error('The root export returned an invalid clamp01 result');
    }
    if (typeof rootModule.mergeAudioSampleManifests !== 'function') {
      throw new Error('The root export does not expose mergeAudioSampleManifests');
    }
    const mergedManifest = rootModule.mergeAudioSampleManifests(
      { shared: { kind: 'url', url: 'https://example.invalid/base.wav' } },
      { shared: { kind: 'url', url: 'https://example.invalid/additions.wav' } },
    );
    if (mergedManifest.shared.url !== 'https://example.invalid/base.wav') {
      throw new Error('The root export returned an invalid manifest merge (base must win over additions)');
    }
    if (typeof rootModule.parseMinecraftSoundsJson !== 'function' || typeof rootModule.MINECRAFT_26_2_SOUNDS_JSON !== 'object') {
      throw new Error('The root export does not expose the Minecraft sounds.json parser');
    }
    const parsedRegistry = rootModule.parseMinecraftSoundsJson(rootModule.MINECRAFT_26_2_SOUNDS_JSON, { namespace: 'minecraft' })
    if (typeof parsedRegistry !== 'object' || parsedRegistry === null) {
      throw new Error('The root export returned an invalid parsed sounds registry');
    }
    console.log('verified ' + packageName + ' exports: ' + specifiers.join(', '));
  `;
  run("node", ["--input-type=module", "--eval", probe], {
    cwd: consumerDirectory,
    timeoutMs: 30_000,
  });

  const typeConsumerSource = `
${typeConsumerSubpathImports}

import {
  isSoundCueId,
  cueDefinition,
  SOUND_CUE_IDS,
  clamp01,
  clampNonNegative,
  clampPan,
  VOLUME_CATEGORIES,
  DEFAULT_VOLUME_SETTINGS,
  mergeAudioSampleManifests,
  parseMinecraftSoundsJson,
  MINECRAFT_26_2_SOUNDS_JSON,
  type SoundCueId,
  type CueDefinition,
  type VolumeCategory,
  type VolumeSettings,
  type AudioSampleManifest,
} from ${JSON.stringify(packageName)}

const declaredPackageExports: readonly object[] = [
${typeConsumerSubpathUses}
]
if (declaredPackageExports.length !== ${importSpecifiers.length}) {
  throw new Error('The TypeScript consumer did not load every declared package export')
}

const cueId: SoundCueId = 'blockBreak'
if (!isSoundCueId(cueId)) {
  throw new Error('Cue declaration consumer returned an invalid result')
}
const definition: CueDefinition = cueDefinition(cueId)
const category: VolumeCategory = VOLUME_CATEGORIES[0]
const settings: VolumeSettings = DEFAULT_VOLUME_SETTINGS
const manifest: AudioSampleManifest = mergeAudioSampleManifests(
  { a: { kind: 'url', url: 'https://example.invalid/a.wav' } },
  {},
)
const parsed = parseMinecraftSoundsJson(MINECRAFT_26_2_SOUNDS_JSON, { namespace: 'minecraft' })
if (
  typeof definition.baseGain !== 'number' ||
  typeof settings[category] !== 'number' ||
  clamp01(2) !== 1 ||
  clampNonNegative(-2) !== 0 ||
  clampPan(2) !== 1 ||
  manifest.a === undefined ||
  parsed === undefined
) {
  throw new Error('Declaration consumer returned an invalid result')
}
`;
  if (typeConsumerSource.trim().length === 0) {
    throw new Error("TypeScript consumer source must not be empty");
  }
  await writeFile(
    join(consumerDirectory, "consumer.ts"),
    typeConsumerSource.trimStart(),
  );
  await writeFile(
    join(consumerDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: false,
        },
        files: ["consumer.ts"],
      },
      null,
      2,
    )}\n`,
  );
  run(
    process.execPath,
    [
      typeScriptCompiler,
      "--project",
      join(consumerDirectory, "tsconfig.json"),
      "--pretty",
      "false",
    ],
    { cwd: consumerDirectory, timeoutMs: 30_000 },
  );
  console.log(`verified ${packageName} declaration consumer typecheck`);

  console.log(`verified package archive ${relative(root, archivePath)}`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

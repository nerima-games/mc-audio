import { createRequire } from 'node:module';
import path from 'node:path';

const requireFromPackage = createRequire(import.meta.url);
const { API, NodeBuilderFlags, SymbolFlags, isIntersectionType, isUnionType } =
  requireFromPackage('typescript/unstable/sync');

const [baseArgument, headArgument, outputFormat = 'json'] = process.argv.slice(2);
const baseRoot = baseArgument && path.resolve(baseArgument);
const headRoot = headArgument && path.resolve(headArgument);
if (!baseRoot || !headRoot) {
  throw new Error('Usage: node scripts/compare-public-api.mjs <base-package-root> <head-package-root> [json|markdown]');
}
if (!['json', 'markdown'].includes(outputFormat)) {
  throw new Error(`Unsupported output format: ${outputFormat}`);
}

// These masks are TypeScript compiler flags.
// oxlint-disable-next-line no-bitwise
const typeKinds = SymbolFlags.TypeAlias | SymbolFlags.Interface;
// TypeScript 7.0 SyntaxKind values; syntax preserves union branches within intersections.
const syntaxKind = { UnionType: 193, IntersectionType: 194, ParenthesizedType: 197 };
// oxlint-disable-next-line no-bitwise
const typeTextFlags = NodeBuilderFlags.NoTruncation | NodeBuilderFlags.NoTypeReduction;
const requiredReexports = [
  'FreeMusicEventId',
  'FreeMusicEventVariant',
  'FreeMusicTrack',
  'FREE_MINECRAFT_MUSIC_TRACKS',
];

const typeText = (checker, type, location) => checker.typeToString(type, location, typeTextFlags);

const resolveNode = (node, project) => {
  if (typeof node?.resolve === 'function') {
    return node.resolve(project);
  }
  return node;
};

const resolveAlias = (checker, symbol) => {
  let current = symbol;
  const seen = new Set();
  // oxlint-disable-next-line no-bitwise
  while (current && current.flags & SymbolFlags.Alias) {
    if (seen.has(current)) {
      throw new Error(`Cyclic export alias: ${current.name}`);
    }
    seen.add(current);
    current = checker.getAliasedSymbol(current);
  }
  if (!current || checker.isUnknownSymbol(current)) {
    throw new Error(`Could not resolve exported symbol ${symbol?.name ?? '<unknown>'}`);
  }
  return current;
};

const declarationFor = (symbol, project) => (symbol.valueDeclaration ?? symbol.declarations?.[0])?.resolve(project);

const isPackageDeclaration = (symbol, project) => (symbol.declarations ?? []).some((declaration) => {
    const filename = declaration.resolve(project).getSourceFile().fileName.replaceAll('\\', '/');
    return filename.includes('/dist/') || filename.includes('/node_modules/@nerima-games/mc-kernel/');
  });

const isOptional = (symbol, project) =>
  // oxlint-disable-next-line no-bitwise
  Boolean(symbol.flags & SymbolFlags.Optional) ||
  (symbol.declarations ?? []).some((declaration) => Boolean(declaration.resolve(project).questionToken));

const propertyData = (checker, symbol, project, fallback) => {
  const declaration = (symbol.valueDeclaration ?? symbol.declarations?.[0])?.resolve(project) ?? fallback;
  const source = declaration.getText().trimStart();
  const method = Array.isArray(declaration.parameters);
  const optional = isOptional(symbol, project);
  let type = typeText(checker, checker.getTypeOfSymbolAtLocation(symbol, declaration), declaration);
  if (optional && !method) {
    type = type.replace(/\s*\|\s*undefined$/, '').replace(/^undefined\s*\|\s*/, '');
  }
  if (method) {
    type = type.replace(
      /(?<optionalParameter>\w+\?)\s*:\s*(?<parameterType>[^,)=]+?)\s*\|\s*undefined(?=[,)=])/g,
      '$<optionalParameter>: $<parameterType>',
    );
  }
  return {
    type,
    optional,
    readonly: source.startsWith('readonly '),
    method,
  };
};

const fieldsForType = (checker, type, project, fallback) => {
  const fields = new Map();
  for (const property of checker.getPropertiesOfType(type)) {
    if (/^\d+$/.test(property.name) || property.name.startsWith('~effect/') || !isPackageDeclaration(property, project)) {
      continue;
    }
    fields.set(property.name, propertyData(checker, property, project, fallback));
  }
  return fields;
};

const referencedAliasType = (node, checker, project) => {
  if (!node.typeName) {
    return undefined;
  }
  const symbol = checker.getSymbolAtLocation(resolveNode(node.typeName, project));
  if (!symbol) {
    return undefined;
  }
  const target = resolveAlias(checker, symbol);
  // oxlint-disable-next-line no-bitwise
  if (!(target.flags & SymbolFlags.TypeAlias)) {
    return undefined;
  }
  const declaration = target.declarations?.find((candidate) => candidate.resolve(project).type);
  return declaration?.resolve(project).type;
};

const mergeFields = (left, right) => {
  const merged = new Map(left);
  for (const [name, value] of right) {
    merged.set(name, value);
  }
  return merged;
};

const expandTypeNode = (node, checker, project, fallback, seen = new Set()) => {
  const resolved = resolveNode(node, project);
  const type = checker.getTypeAtLocation(resolved);
  const union = isUnionType(type);
  const intersection = isIntersectionType(type);
  if (resolved.kind === syntaxKind.ParenthesizedType) {
    return expandTypeNode(resolved.type, checker, project, fallback, seen);
  }
  if (resolved.kind === syntaxKind.UnionType || resolved.kind === syntaxKind.IntersectionType) {
    const branches = resolved.types.map((child) => expandTypeNode(child, checker, project, fallback, seen));
    if (resolved.kind === syntaxKind.UnionType) {
      return branches.flat();
    }
    return branches.reduce((products, next) => products.flatMap((left) =>
      next.map((right) => mergeFields(left, right))), [new Map()]);
  }
  if (union || intersection) {
    const aliasType = referencedAliasType(resolved, checker, project);
    if (aliasType) {
      const key = `${aliasType.getSourceFile().fileName}:${aliasType.pos}`;
      if (seen.has(key)) {
        throw new Error(`Cyclic type alias while expanding ${resolved.getText()}`);
      }
      const nestedSeen = new Set(seen).add(key);
      return expandTypeNode(aliasType, checker, project, fallback, nestedSeen);
    }
    return [fieldsForType(checker, type, project, resolved ?? fallback)];
  }
  return [fieldsForType(checker, type, project, resolved ?? fallback)];
};

const variantLabel = (fields, index) => {
  const discriminants = [];
  for (const key of ['kind', 'type', 'category']) {
    const value = fields.get(key)?.type;
    const match = typeof value === 'string' && value.match(/^['"](?<value>[^'"]+)['"]$/);
    if (match?.groups?.value) {
      discriminants.push(`${key}=${match.groups.value}`);
    }
  }
  if (discriminants.length) {
    return discriminants.join(',');
  }
  return `variant-${index + 1}`;
};

const variantsForType = (symbol, checker, project, source) => {
  const declaration = (symbol.declarations ?? []).map((item) => item.resolve(project))
    .find((item) => item.type);
  if (!declaration) {
    return [{
      label: 'variant-1',
      fields: fieldsForType(checker, checker.getDeclaredTypeOfSymbol(symbol), project, source),
    }];
  }
  const variants = expandTypeNode(declaration.type, checker, project, declaration);
  return variants.map((fields, index) => ({ label: variantLabel(fields, index), fields }));
};

const scan = (label, root) => {
  const entry = path.join(root, 'dist/index.d.ts');
  const api = new API({ cwd: root });
  try {
    const snapshot = api.updateSnapshot({ openFiles: [entry] });
    const project = snapshot.getDefaultProjectForFile(entry);
    if (!project) {
      throw new Error(`No TypeScript project for ${entry}`);
    }
    const { program, checker } = project;
    const source = program.getSourceFile(entry);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!source || !moduleSymbol) {
      throw new Error(`Could not load package root declaration ${entry}`);
    }
    const exports = new Map();
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      try {
        const target = resolveAlias(checker, exported);
        // oxlint-disable-next-line no-bitwise
        const kind = target.flags & typeKinds ? 'type' : target.flags & SymbolFlags.Value ? 'value' : 'other';
      const declaration = declarationFor(target, project) ?? source;
      let fullType = '';
      let aliasType = undefined;
      let variants = [];
      let arrayElementMembers = undefined;
      if (kind === 'value' && exported.name === 'FREE_MINECRAFT_MUSIC_TRACKS') {
        const type = checker.getTypeOfSymbolAtLocation(exported, declaration);
        fullType = typeText(checker, type, declaration);
        const typeArguments = checker.getTypeArguments(type);
        if (!typeArguments?.length || !fullType.includes('[]')) {
          throw new Error('FREE_MINECRAFT_MUSIC_TRACKS is not an array type');
        }
        arrayElementMembers = Object.fromEntries(fieldsForType(checker, typeArguments[0], project, declaration));
      } else if (kind === 'type') {
        const aliasDeclaration = (target.declarations ?? []).map((item) => item.resolve(project)).find((item) => item.type);
        fullType = typeText(checker, checker.getDeclaredTypeOfSymbol(target), declaration);
        aliasType = aliasDeclaration?.type.getText();
        variants = variantsForType(target, checker, project, source).map(({ label: variant, fields }) => ({
          variant,
          fields: Object.fromEntries(fields),
        }));
      }
      exports.set(exported.name, { name: exported.name, kind, fullType, aliasType, variants, arrayElementMembers });
      } catch (error) {
        throw new Error(`${label} export ${exported.name}: ${error.message}`, { cause: error });
      }
    }
    const missing = requiredReexports.filter((name) => !exports.has(name));
    if (missing.length) {
      throw new Error(`${label} package root is missing re-exports: ${missing.join(', ')}`);
    }
    const semanticDiagnostics = program.getSemanticDiagnostics(entry).length;
    if (semanticDiagnostics) {
      throw new Error(`${label} package root has ${semanticDiagnostics} semantic diagnostics`);
    }
    return {
      label,
      exportCount: exports.size,
      declarationFiles: program.getSourceFileNames().filter((name) => name.endsWith('.d.ts')).length,
      semanticDiagnostics,
      exports,
    };
  } finally {
    api.close();
  }
};

const memberChange = (before, after) => {
  if (!before) {
    return 'added';
  }
  if (!after) {
    return 'removed';
  }
  if (before.optional !== after.optional) {
    return 'optionality';
  }
  if (before.readonly !== after.readonly || before.method !== after.method) {
    return 'declaration-form';
  }
  return 'type';
};

const compareFields = (name, oldVariants, newVariants, destination) => {
  const pairs = [];
  const oldByLabel = new Map(oldVariants.map((variant, index) => [variant.variant, { variant, index }]));
  const newByLabel = new Map(newVariants.map((variant, index) => [variant.variant, { variant, index }]));
  if (oldVariants.length === 1 && newVariants.length > 1) {
    for (const [index, variant] of newVariants.entries()) {
      pairs.push([oldVariants[0], variant, index]);
    }
  } else if (newVariants.length === 1 && oldVariants.length > 1) {
    for (const [index, variant] of oldVariants.entries()) {
      pairs.push([variant, newVariants[0], index]);
    }
  } else {
    for (const [index, current] of newVariants.entries()) {
      const prior = oldByLabel.get(current.variant)?.variant ?? oldVariants[index];
      if (prior) {
        pairs.push([prior, current, index]);
      } else {
        pairs.push([undefined, current, index]);
      }
    }
    for (const [index, prior] of oldVariants.entries()) {
      if (!newByLabel.has(prior.variant) && !newVariants[index]) {
        pairs.push([prior, undefined, index]);
      }
    }
  }
  for (const [prior, current, index] of pairs) {
    const fields = new Set([Object.keys(prior?.fields ?? {}), Object.keys(current?.fields ?? {})].flat());
    const variant = oldVariants.length > 1 || newVariants.length > 1
      ? current?.variant ?? prior?.variant ?? `variant-${index + 1}`
      : undefined;
    for (const field of [...fields].sort()) {
      const before = prior?.fields[field];
      const after = current?.fields[field];
      const changed = !before || !after || before.type !== after.type || before.optional !== after.optional ||
        before.readonly !== after.readonly || before.method !== after.method;
      if (changed) {
        destination.push({
          name,
          ...(variant ? { variant } : {}),
          field,
          change: memberChange(before, after),
          old: before ?? null,
          new: after ?? null,
        });
      }
    }
  }
};

const base = scan('base', baseRoot);
const head = scan('head', headRoot);
const baseNames = new Set(base.exports.keys());
const headNames = new Set(head.exports.keys());
const sharedNames = [...baseNames].filter((name) => headNames.has(name)).sort();
const addedExports = [...headNames].filter((name) => !baseNames.has(name)).sort();
const removedExports = [...baseNames].filter((name) => !headNames.has(name)).sort();
const addedTypeExports = addedExports.map((name) => head.exports.get(name))
  .filter((entry) => entry.kind === 'type')
  .map(({ name, fullType, aliasType, variants }) => ({ name, declaration: aliasType ?? fullType, variants }));
const changedTypeMembers = [];
const changedAliases = [];
const changedArrayElementMembers = [];

for (const name of sharedNames) {
  const before = base.exports.get(name);
  const after = head.exports.get(name);
  if (before.kind === 'type' && after.kind === 'type') {
    const oldVariants = before.variants;
    const newVariants = after.variants;
    const hasObjectShape = oldVariants.some((variant) => Object.keys(variant.fields).length) || newVariants.some((variant) => Object.keys(variant.fields).length);
    if (hasObjectShape) {
      compareFields(name, oldVariants, newVariants, changedTypeMembers);
    } else if (before.fullType !== after.fullType || before.aliasType !== after.aliasType) {
      const sourceTypesDiffer = before.aliasType !== after.aliasType;
      changedAliases.push({
        name,
        base: sourceTypesDiffer ? before.aliasType : before.fullType,
        head: sourceTypesDiffer ? after.aliasType : after.fullType,
      });
    }
  }
}

const oldTrackFields = base.exports.get('FREE_MINECRAFT_MUSIC_TRACKS').arrayElementMembers;
const newTrackFields = head.exports.get('FREE_MINECRAFT_MUSIC_TRACKS').arrayElementMembers;
if (!oldTrackFields || !newTrackFields) {
  throw new Error('Could not inspect FREE_MINECRAFT_MUSIC_TRACKS array element types');
}
for (const field of [...new Set([...Object.keys(oldTrackFields), ...Object.keys(newTrackFields)])].sort()) {
  const before = oldTrackFields[field];
  const after = newTrackFields[field];
  if (!before || !after || before.type !== after.type || before.optional !== after.optional || before.readonly !== after.readonly || before.method !== after.method) {
    changedArrayElementMembers.push({
      name: 'FREE_MINECRAFT_MUSIC_TRACKS[*]',
      field,
      change: memberChange(before, after),
      old: before ?? null,
      new: after ?? null,
    });
  }
}

const typeNames = new Set(changedTypeMembers.map((member) => member.name));
const freeEventVariantCount = changedTypeMembers.filter((member) => member.name === 'FreeMusicEventVariant').length;
const freeTrackCount = changedTypeMembers.filter((member) => member.name === 'FreeMusicTrack').length;
if (freeEventVariantCount !== 8 || freeTrackCount !== 6) {
  throw new Error(`Expected eight FreeMusicEventVariant and six FreeMusicTrack member changes; got ${freeEventVariantCount} and ${freeTrackCount}`);
}
if (!changedAliases.some((alias) => alias.name === 'FreeMusicEventId')) {
  throw new Error('The FreeMusicEventId alias change was not reported');
}
if (changedArrayElementMembers.length !== 6) {
  throw new Error(`Expected six FREE_MINECRAFT_MUSIC_TRACKS element changes; got ${changedArrayElementMembers.length}`);
}
const result = {
  summary: {
    basePublicExports: base.exportCount,
    headPublicExports: head.exportCount,
    addedExports: addedExports.length,
    removedExports: removedExports.length,
    changedExportedTypeMembers: changedTypeMembers.length,
    changedExportedTypes: typeNames.size,
    changedArrayElementMembers: changedArrayElementMembers.length,
    changedAliases: changedAliases.length,
    baseSemanticDiagnostics: base.semanticDiagnostics,
    headSemanticDiagnostics: head.semanticDiagnostics,
  },
  addedExports,
  removedExports,
  addedTypeExports,
  changedAliases,
  changedTypeMembers,
  changedArrayElementMembers,
};
if (outputFormat === 'json') {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  const renderType = (field) => {
    if (!field) {
      return '`absent`';
    }
    const optional = field.optional ? '?' : '';
    const method = field.method ? ' (method)' : '';
    return `\`${field.type.replaceAll('|', '\\|')}${optional}\`${method}`;
  };
  const rows = changedTypeMembers.map((member) => {
    const variant = member.variant ? `[${member.variant}]` : '';
    return `| \`${member.name}${variant}.${member.field}\` | ${renderType(member.old)} | ${renderType(member.new)} |`;
  });
  const arrayRows = changedArrayElementMembers.map((member) =>
    `| \`${member.name}.${member.field}\` | ${renderType(member.old)} | ${renderType(member.new)} |`,
  );
  const aliasRows = changedAliases.map((alias) =>
    `| \`${alias.name}\` | \`${alias.base.replaceAll('|', '\\|')}\` | \`${alias.head.replaceAll('|', '\\|')}\` |`,
  );
  process.stdout.write([
    `Type members: ${result.summary.changedExportedTypeMembers} across ${result.summary.changedExportedTypes} exported types.`,
    '',
    '| Exported type member | Base declaration | Head declaration |',
    '| --- | --- | --- |',
    ...rows,
    '',
    `Constant array element members: ${arrayRows.length}.`,
    '',
    '| Exported constant element member | Base declaration | Head declaration |',
    '| --- | --- | --- |',
    ...arrayRows,
    '',
    `Changed type aliases: ${aliasRows.length}.`,
    '',
    '| Exported type alias | Base declaration | Head declaration |',
    '| --- | --- | --- |',
    ...aliasRows,
    '',
  ].join('\n'));
}

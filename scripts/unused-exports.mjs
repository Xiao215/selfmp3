import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import ts from 'typescript'

/**
 * Exported names that nothing reads, by the import graph, across platform twins.
 *
 * An export is read when another module imports that name from the module that
 * declares it: by a relative path, through `@/` in the app, or through a
 * `@selfmp3/*` package's entry, following the barrels that re-export it
 * (`export { x } from`, `export * from`) down to the declaration. A file that
 * merely spells the name does not count. That is what the textual check before
 * this one missed: an export whose name is also an ordinary word (`Folder`,
 * `Speed`, `PLAIN`), one only a barrel re-exported, or one only its own test
 * read, all looked read.
 *
 * Tests exist to name the thing they test; they cannot make it used. So a read
 * from a test counts in two cases only: the module is test support (everything
 * that imports it is a test, as a fixture is), or the module uses the name
 * itself, and exports it only so a test can reach it.
 *
 * The app resolves `./covers` to covers.ts on a phone and covers.web.ts in a
 * browser, so the same name is declared in both. `x.ts`, `x.web.ts` and
 * `x.desktop.ts` are collapsed onto one identity, one module here, and a twin
 * cannot vouch for its twin. `forgetCovers` sat uncalled behind exactly that.
 *
 * A barrel's own named re-export (`export { x } from './y.js'`) is checked
 * too: one that no import passes through is reported at the barrel, even when
 * the package reads `x` directly from `./y.js`.
 *
 * Files are parsed with TypeScript's own parser, one at a time and without a
 * program: the app's project and the server's cannot be loaded together, which
 * is why the root eslint config skips apps/app. What it reports is checked by
 * hand; ALLOWED below is that judgement, written down.
 */

/**
 * Declarations whose surface is meant to be wider than its readers.
 *
 * A wire contract is written out in full on purpose: a schema for something
 * that crosses the network belongs beside the rest whether or not this commit
 * happens to parse it, and the same goes for the extension's messages. The
 * doorman's fakes are a fixture module, which exists to be reached into. These
 * are the three the de-export pass left alone for the same reason.
 *
 * Shared's schemas are the one place where that licence is given by name and
 * not by file. The whole folder used to be skipped, and that skip quietly
 * covered a frame rate and a labels table nobody read as well — so the
 * exemption is now only for what it was written for: a `*Schema`, and the type
 * `z.infer` gives it, which is the same declaration written on a second line.
 * Everything else in there is code like any other, and is checked like any
 * other.
 */
const skipDeclaration = (file, text, name) =>
  EXCLUDED.some(skip => file.includes(skip)) ||
  (file.includes(SCHEMAS) &&
    (name.endsWith('Schema') || text.includes(`export type ${name} = z.infer<`)))

const SCHEMAS = 'packages/shared/src/schemas/' // the server-to-client contract

const EXCLUDED = [
  'apps/extension/src/bridge.ts', // the extension's own contract
  'apps/doorman/src/fakes.ts', // test fixtures, reached into by name
  '/verify/', // Playwright helpers, run by a config rather than imported
]

/**
 * Names that are exported, unread, and meant to be.
 *
 * A port's contract types are the honest case: `CoverFiles` and `SecretStore`
 * describe what both twins implement, so of course only the twins name them.
 * Add to this with a reason, or the next person deletes something load-bearing.
 */
const ALLOWED = new Map([
  // Port contracts: the shape each platform twin implements.
  ['CoverFiles', 'the coverFiles port, implemented by both twins'],
  ['DeepLinkRoute', 'the deepLinks port'],
  ['DownloadsFolder', 'the downloadsFolder port'],
  ['LoginItem', 'the loginItem port'],
  ['MediaSessionActions', 'the mediaSession port'],
  ['PointerHold', 'the pointerHold port, implemented by both twins'],
  ['MediaSessionPort', 'the mediaSession port'],
  ['NowPlaying', 'the mediaSession port'],
  ['PrefStore', 'the prefs port'],
  ['SecretStore', 'the secrets port'],
  ['UpdatesPort', 'the updates port'],
  ['MacAppPort', 'the macApp port'],
  ['CommandHandlers', 'the useCommands hook, both twins'],
  ['EscapeOptions', 'the useEscape hook, both twins'],
  ['HotkeyOptions', 'the useHotkeys hook, both twins'],
  ['Hotkeys', 'the useHotkeys hook, both twins'],
  // Props shared by a component and its twin.
  ['SongVisualProps', 'SongVisual, both twins'],
  ['MovingProps', 'StageMove, both twins'],
  // Module state a test empties between cases; nothing the app runs needs it.
  ['forgetChipWidths', 'rowTags.ts, emptied between its tests'],
  ['resetImportDraft', 'importDraft.ts, emptied between the review tests'],
])

/**
 * The second pass: members of a surface, not exports.
 *
 * The pass above sees `export interface Container` as one name, and that name
 * is read everywhere. What it cannot see is that `Container.libraryVersion`
 * or `StorageDriver.move` has no reader at all — a member of an interface or
 * of a returned object literal is never exported on its own, so nothing here
 * ever asked about it, and a dozen dead members sat behind exactly that.
 *
 * So the surfaces whose members are only ever reached as `x.<member>` are
 * listed by hand, each with the expression that spells its members, the
 * region of the file they sit in, and where their readers can be. A member is
 * read when a file there, outside the surface's own module, reaches it as
 * `.member` or takes it by destructuring (`const { config, logger } =
 * container`). An implementation of the interface spells the name too, as
 * `member(` or `member:` — which is why a bare word is not enough, and why the
 * declaring file itself does not count. Readers are confined to the workspaces
 * that can hold the surface because `.move` is also what a phone's file API is
 * called with: the server's storage driver has no reader in apps/app, and a
 * search that looked there would have vouched for a dead member.
 */
const SURFACES = [
  {
    // The object literal `createApi` returns: the client's whole API.
    file: 'packages/client/src/api/api.ts',
    within: [/^ {2}return \{$/m, /^ {2}\}$/m],
    member: /^ {4}(\w+): /gm,
    readers: ['packages/client/', 'apps/app/', 'apps/desktop/', 'apps/extension/'],
  },
  {
    // The composition root's interface.
    file: 'apps/server/src/container.ts',
    within: [/^export interface Container \{$/m, /^\}$/m],
    member: /^ {2}(?:readonly )?(\w+)[(:]/gm,
    readers: ['apps/server/'],
  },
  {
    // The storage abstraction and its stat, both implemented by two drivers.
    file: 'apps/server/src/storage/driver.ts',
    member: /^ {2}(?:readonly )?(\w+)[(:]/gm,
    readers: ['apps/server/'],
  },
  {
    // Every interface of the playback port: state, capabilities, wiring, engine.
    file: 'packages/client/src/ports/engine.ts',
    member: /^ {2}(?:readonly )?(\w+)\??[(:]/gm,
    readers: ['packages/client/', 'apps/app/'],
  },
]

/**
 * Members nothing reads, and meant to be. Keyed `file#member`, with the
 * reason, like ALLOWED above.
 */
const ALLOWED_MEMBERS = new Map([])

/** `x.web.ts` and `x.desktop.ts` are the same module as `x.ts`, to the bundler. */
const identity = file => file.replace(/\.(web|desktop|native|ios|android)(?=\.tsx?$)/, '')

/** A test, or a harness run by a test runner: its reads do not make a name used. */
const isTest = file =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
  file.includes('/verify/') ||
  file.startsWith('verify/') ||
  file.includes('/__mocks__/') ||
  /(^|\/)jest\.setup\.[jt]s$/.test(file)

// Tracked and not-yet-tracked alike: a file just written can be the only reader.
const listed = execFileSync(
  'git',
  [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '*.ts',
    '*.tsx',
    '*.mts',
    '*.mjs',
    '*.js',
    '*.cjs',
  ],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(file => file && !file.includes('node_modules/') && !/(^|\/)dist\//.test(file))

/** TypeScript sources: the modules whose exports are checked, and readers. */
const source = new Map()
/** Every file that can import one: the sources, and the build scripts beside them. */
const readers = new Map()
for (const file of listed) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue // Listed by git and not on disk: a deletion that is not committed yet.
  }
  const typescript = /\.tsx?$/.test(file)
  if (typescript && (file.startsWith('apps/') || file.startsWith('packages/'))) {
    source.set(file, text)
  }
  if (typescript || /\bimport\b|\brequire\(/.test(text)) readers.set(file, text)
}

/** Identity → the files that share it. */
const groups = new Map()
for (const file of readers.keys()) {
  if (!/\.tsx?$/.test(file)) continue
  const key = identity(file)
  groups.set(key, [...(groups.get(key) ?? []), file])
}

/** `@selfmp3/name` → its folder and package.json, for package entries. */
const workspaces = new Map()
for (const root of ['apps', 'packages']) {
  for (const entry of readdirSync(root)) {
    const manifest = join(root, entry, 'package.json')
    if (!existsSync(manifest)) continue
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    workspaces.set(pkg.name, { dir: join(root, entry), pkg })
  }
}

/** The identity a path without its extension stands for, or null. */
function moduleAt(base) {
  const stem = base.replace(/\.(js|jsx|ts|tsx|mjs)$/, '')
  for (const candidate of [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`]) {
    // `./covers.web` names the same module as `./covers`.
    if (groups.has(identity(candidate))) return identity(candidate)
  }
  return null
}

/** A package's export target in `dist/`, as the source file it is built from. */
function sourceOf(dir, target) {
  const path = typeof target === 'string' ? target : (target?.default ?? target?.types)
  if (typeof path !== 'string') return null
  return moduleAt(join(dir, path.replace(/^\.\/dist\//, 'src/').replace(/\.d\.ts$/, '.ts')))
}

/** Where `specifier`, imported from `from`, lands: an identity, or null outside the tree. */
function resolve(from, specifier) {
  if (specifier.startsWith('.')) return moduleAt(normalize(join(dirname(from), specifier)))
  if (specifier.startsWith('@/') && from.startsWith('apps/app/')) {
    return moduleAt(join('apps/app/src', specifier.slice(2)))
  }
  const match = /^(@selfmp3\/[^/]+)(?:\/(.+))?$/.exec(specifier)
  const workspace = match && workspaces.get(match[1])
  if (!workspace) return null
  const { dir, pkg } = workspace
  const sub = match[2] ? `./${match[2]}` : '.'
  if (pkg.exports) return sourceOf(dir, pkg.exports[sub])
  if (sub === '.' && pkg.main) return moduleAt(join(dir, pkg.main))
  return match[2] ? moduleAt(join(dir, match[2])) : null
}

const kindOf = file =>
  file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : /\.[cm]?jsx?$/.test(file)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS

const exported = node =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword) &&
  !(ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.DefaultKeyword)

/**
 * One file's side of the graph: what it declares and re-exports, and what it
 * imports from where.
 */
function parse(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kindOf(file))
  const declared = []
  /** `export { imported as name } from 'specifier'`. */
  const forwards = []
  /** `export * from 'specifier'`. */
  const stars = []
  /** { specifier, names: string[] | 'all' }, every name this file takes from a module. */
  const imports = []

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text
      const bindings = statement.importClause?.namedBindings
      if (!bindings) imports.push({ specifier, names: [] })
      else if (ts.isNamespaceImport(bindings)) {
        imports.push({ specifier, names: namespaceReads(text, bindings.name.text) })
      } else {
        imports.push({
          specifier,
          names: bindings.elements.map(each => (each.propertyName ?? each.name).text),
        })
      }
    } else if (ts.isExportDeclaration(statement)) {
      const specifier =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : null
      const clause = statement.exportClause
      if (specifier === null) {
        // `export { a as b }` of the file's own names.
        if (clause && ts.isNamedExports(clause)) {
          for (const each of clause.elements) declared.push(each.name.text)
        }
      } else if (!clause) stars.push(specifier)
      else if (ts.isNamespaceExport(clause)) imports.push({ specifier, names: 'all' })
      else {
        for (const each of clause.elements) {
          forwards.push({
            name: each.name.text,
            imported: (each.propertyName ?? each.name).text,
            specifier,
          })
        }
      }
    } else if (exported(statement)) {
      if (ts.isVariableStatement(statement)) {
        for (const each of statement.declarationList.declarations) {
          if (ts.isIdentifier(each.name)) declared.push(each.name.text)
        }
      } else if (statement.name && ts.isIdentifier(statement.name)) {
        declared.push(statement.name.text)
      }
    }
  }

  // `import('x')`, `require('x')` and `typeof import('x').Name`, wherever they are.
  const visit = node => {
    if (ts.isImportTypeNode(node)) {
      const argument = node.argument
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        const qualifier = node.qualifier
        const first = qualifier
          ? ts.isIdentifier(qualifier)
            ? qualifier.text
            : qualifier.left.getText(sf).split('.')[0]
          : null
        imports.push({ specifier: argument.literal.text, names: first ? [first] : 'all' })
      }
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      imports.push({ specifier: node.arguments[0].text, names: destructured(node) })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { declared, forwards, stars, imports }
}

/** `const { a, b } = await import('x')` reads a and b; anything else, the whole module. */
function destructured(call) {
  let node = call.parent
  if (node && ts.isAwaitExpression(node)) node = node.parent
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))) {
    node = node.parent
  }
  if (node && ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
    return node.name.elements.map(each =>
      each.propertyName && ts.isIdentifier(each.propertyName)
        ? each.propertyName.text
        : each.name.getText(),
    )
  }
  return 'all'
}

/** `import * as ns`: the names read as `ns.name`, or all of them when ns is used any other way. */
function namespaceReads(text, ns) {
  const names = []
  const uses = [...text.matchAll(new RegExp(`(?<![\\w$.])${ns}\\b(\\??\\.(\\w+))?`, 'g'))]
  // The first is the import itself.
  for (const [, dot, name] of uses.slice(1)) {
    if (!dot) return 'all'
    names.push(name)
  }
  return names
}

const graph = new Map()
for (const [file, text] of readers) graph.set(file, parse(file, text))

/** Identity → its declared names, forwards and stars, over every twin but tests. */
const modules = new Map()
for (const [key, files] of groups) {
  const module = { declared: new Set(), forwards: [], stars: [], files }
  for (const file of files) {
    const own = graph.get(file)
    // A test's own exports are its own business; the twins' are the module's.
    if (isTest(file)) continue
    for (const name of own.declared) module.declared.add(name)
    for (const forward of own.forwards) {
      module.forwards.push({ ...forward, target: resolve(file, forward.specifier), file })
    }
    for (const star of own.stars) {
      const target = resolve(file, star)
      if (target) module.stars.push(target)
    }
  }
  modules.set(key, module)
}

/** (identity, name) → the files that read it, and barrel forwards anyone passed through. */
const reads = new Map()
const passed = new Set()
/** identity → every file that imports it at all. */
const importers = new Map()

const readKey = (key, name) => `${key}\u0000${name}`

/** Follow `name` from `key` through its barrels to every declaration it can be. */
function follow(key, name, reader, seen = new Set()) {
  const here = readKey(key, name)
  if (seen.has(here)) return
  seen.add(here)
  const module = modules.get(key)
  if (!module) return
  if (module.declared.has(name)) {
    if (!reads.has(here)) reads.set(here, new Set())
    reads.get(here).add(reader)
  }
  for (const forward of module.forwards) {
    if (forward.name !== name) continue
    passed.add(readKey(key, name))
    if (forward.target) follow(forward.target, forward.imported, reader, seen)
  }
  for (const target of module.stars) follow(target, name, reader, seen)
}

/** Every name `key` offers, its own and what it forwards, for a read of the whole module. */
function everything(key, seen = new Set()) {
  if (seen.has(key)) return []
  seen.add(key)
  const module = modules.get(key)
  if (!module) return []
  return [
    ...module.declared,
    ...module.forwards.map(forward => forward.name),
    ...module.stars.flatMap(target => everything(target, seen)),
  ]
}

for (const [file, { imports, forwards, stars }] of graph) {
  const touched = [
    ...imports.map(({ specifier }) => specifier),
    ...forwards.map(({ specifier }) => specifier),
    ...stars,
  ]
  for (const specifier of touched) {
    const key = resolve(file, specifier)
    if (!key) continue
    if (!importers.has(key)) importers.set(key, new Set())
    importers.get(key).add(file)
  }
  for (const { specifier, names } of imports) {
    const key = resolve(file, specifier)
    if (!key || key === identity(file)) continue
    for (const name of names === 'all' ? everything(key) : names) follow(key, name, file)
  }
}

/*
 * Expo Router's routes: it reads every file under apps/app/app by its path,
 * and takes what each exports — the screen, and its layout's settings.
 */
for (const key of modules.keys()) {
  if (!key.startsWith('apps/app/app/')) continue
  for (const name of everything(key)) follow(key, name, 'expo-router')
}

/** Every file that imports the module is a test (or it is one), as a fixture is. */
const testSupport = key => {
  const by = [...(importers.get(key) ?? [])].filter(file => identity(file) !== key)
  return by.length > 0 && by.every(isTest)
}

/** The module spells the name past its own declaration, so it is exported only for a test. */
const usedInside = (module, name) => {
  const word = new RegExp(`(?<![\\w$.])${name}\\b`, 'g')
  const own = module.files.filter(file => !isTest(file))
  const spelled = own.reduce((sum, file) => sum + (source.get(file)?.match(word)?.length ?? 0), 0)
  const declaring = own.filter(file => graph.get(file).declared.includes(name)).length
  return spelled > declaring
}

const found = []
for (const [key, module] of modules) {
  const checked = module.files.filter(file => source.has(file) && !isTest(file))
  if (checked.length === 0) continue
  const support = testSupport(key)
  for (const name of module.declared) {
    if (ALLOWED.has(name)) continue
    const file = checked.find(each => graph.get(each).declared.includes(name)) ?? checked[0]
    if (skipDeclaration(file, source.get(file), name)) continue
    const by = [...(reads.get(readKey(key, name)) ?? [])].filter(each => identity(each) !== key)
    if (by.some(each => !isTest(each))) continue
    if (by.length > 0 && (support || usedInside(module, name))) continue
    found.push({ name, where: checked })
  }
  // A barrel's named re-export that no import passes through.
  for (const forward of module.forwards) {
    if (ALLOWED.has(forward.name) || !source.has(forward.file)) continue
    if (EXCLUDED.some(skip => forward.file.includes(skip))) continue
    if (passed.has(readKey(key, forward.name))) continue
    found.push({ name: forward.name, where: [`${forward.file} (re-export)`] })
  }
}

const members = []
for (const { file, within, member, readers } of SURFACES) {
  const text = source.get(file)
  if (text === undefined) throw new Error(`${file} is listed in SURFACES and not in the tree`)
  let region = text
  if (within) {
    const start = text.search(within[0])
    if (start < 0) throw new Error(`${file}: the start of its surface was not found`)
    const end = text.slice(start).search(within[1])
    region = end < 0 ? text.slice(start) : text.slice(start, start + end)
  }
  const names = new Set([...region.matchAll(member)].map(([, name]) => name))
  for (const name of names) {
    if (ALLOWED_MEMBERS.has(`${file}#${name}`)) continue
    const reached = new RegExp(`\\.${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`)
    const outside = [...source].some(
      ([other, body]) =>
        readers.some(prefix => other.startsWith(prefix)) &&
        identity(other) !== identity(file) &&
        !other.includes('.test.') &&
        reached.test(body),
    )
    if (!outside) members.push({ name, file })
  }
}

if (found.length === 0 && members.length === 0) {
  console.log('No exports are unread outside their own module, and no member goes unreached.')
  process.exit(0)
}

if (found.length > 0) {
  console.error(`${found.length} export${found.length === 1 ? '' : 's'} nothing reads:\n`)
  for (const { name, where } of found.sort((a, b) => a.name.localeCompare(b.name))) {
    console.error(`  ${name.padEnd(24)} ${where.join(', ')}`)
  }
  console.error(
    '\nDelete it, or stop exporting it if its own file still uses it.\n' +
      'If it is a port contract both twins implement, add it to ALLOWED in this\n' +
      'script with the reason.',
  )
}

if (members.length > 0) {
  console.error(`\n${members.length} member${members.length === 1 ? '' : 's'} nothing reaches:\n`)
  for (const { name, file } of members.sort((a, b) => a.name.localeCompare(b.name))) {
    console.error(`  ${name.padEnd(24)} ${file}`)
  }
  console.error(
    '\nDelete it from the surface and from whatever implements it.\n' +
      'If it is kept on purpose, add `file#member` to ALLOWED_MEMBERS in this\n' +
      'script with the reason.',
  )
}
process.exit(1)

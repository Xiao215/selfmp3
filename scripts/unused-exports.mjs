import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * Exported names that nothing reads, across platform twins.
 *
 * The app resolves `./covers` to covers.ts on a phone and covers.web.ts in a
 * browser, so the same name is declared in both. A search that reads each file
 * on its own therefore finds every such name "used" — by its own twin — and
 * says nothing. `forgetCovers` sat uncalled behind exactly that: signing out
 * left the previous account's covers on the device, and no tool noticed
 * because covers.web.ts spelled the name too.
 *
 * So a twin group is one unit here. `x.ts`, `x.web.ts` and `x.desktop.ts` are
 * collapsed onto one identity, and a name is unused when nothing *outside*
 * that group mentions it.
 *
 * Deliberately textual, not a type-aware pass. It has one job, it needs no
 * project graph — the app's and the server's cannot be loaded together, which
 * is why the root eslint config skips apps/app — and being crude makes it
 * over-report rather than miss, which is the safe direction. What it does
 * report is checked by hand; ALLOWED below is that judgement, written down.
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
  ['CommandHandlers', 'the useCommands hook, both twins'],
  ['EscapeOptions', 'the useEscape hook, both twins'],
  ['HotkeyOptions', 'the useHotkeys hook, both twins'],
  ['Hotkeys', 'the useHotkeys hook, both twins'],
  // Props shared by a component and its twin.
  ['SongVisualProps', 'SongVisual, both twins'],
  ['MovingProps', 'StageMove, both twins'],
])

const DECLARATION =
  /^export (?:async )?(?:function|const|class|interface|type|enum) ([A-Za-z_$][\w$]*)/gm

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

// Tracked and not-yet-tracked alike: a file just written can be the only reader.
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '*.ts', '*.tsx'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(file => file && (file.startsWith('apps/') || file.startsWith('packages/')))

const source = new Map()
for (const file of files) {
  try {
    source.set(file, readFileSync(file, 'utf8'))
  } catch {
    // Listed by git and not on disk: a deletion that is not committed yet.
  }
}

/** Every file that shares an identity, so a twin cannot vouch for its twin. */
const groups = new Map()
for (const file of source.keys()) {
  const key = identity(file)
  groups.set(key, [...(groups.get(key) ?? []), file])
}

const found = []
for (const [key, members] of groups) {
  // Tests exist to name the thing they test; they cannot make it used.
  if (members.every(file => file.includes('.test.'))) continue
  const names = new Set()
  for (const file of members) {
    if (file.includes('.test.')) continue
    const text = source.get(file)
    for (const [, name] of text.matchAll(DECLARATION)) {
      if (!skipDeclaration(file, text, name)) names.add(name)
    }
  }
  for (const name of names) {
    if (ALLOWED.has(name)) continue
    const word = new RegExp(`\\b${name}\\b`)
    const outside = [...source].some(([file, text]) => identity(file) !== key && word.test(text))
    if (!outside) found.push({ name, where: members.filter(f => !f.includes('.test.')) })
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

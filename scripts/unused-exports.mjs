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

/** `x.web.ts` and `x.desktop.ts` are the same module as `x.ts`, to the bundler. */
const identity = file => file.replace(/\.(web|desktop|native|ios|android)(?=\.tsx?$)/, '')

const files = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], { encoding: 'utf8' })
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

if (found.length === 0) {
  console.log('No exports are unread outside their own module.')
  process.exit(0)
}

console.error(`${found.length} export${found.length === 1 ? '' : 's'} nothing reads:\n`)
for (const { name, where } of found.sort((a, b) => a.name.localeCompare(b.name))) {
  console.error(`  ${name.padEnd(24)} ${where.join(', ')}`)
}
console.error(
  '\nDelete it, or stop exporting it if its own file still uses it.\n' +
    'If it is a port contract both twins implement, add it to ALLOWED in this\n' +
    'script with the reason.',
)
process.exit(1)

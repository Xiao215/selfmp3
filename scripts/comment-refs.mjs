import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'

/**
 * What a comment points at, checked against what is there.
 *
 * The comments here carry an unusual amount of cross-reference — a file by
 * path, a private member by name, a mock board by its id — and that is what
 * makes them worth reading. It is also the one part of them that rots without
 * anybody noticing: a rename moves the code and leaves the sentence about it
 * true but pointing at nothing.
 *
 * An audit on 2026-09-25 found about forty of these. A comment explained a
 * `NO_DRAG` mark that no longer existed anywhere; another sent the reader to
 * `tracks.ts`, deleted; `Tooltip.tsx` and `you.model.ts` were named by files
 * that had themselves been renamed; an icon was called native-only while six
 * cross-platform screens drew it. None of it is caught by a typechecker,
 * because none of it is code. Roughly half of that wave would have been
 * caught by this script, which is why it exists.
 *
 * Deliberately textual and deliberately narrow. It checks three kinds of
 * reference that have a single right answer — a path, a `#member`, a board id
 * — and says nothing about prose. A name that has drifted in meaning rather
 * than disappeared (`total` for one bin's weight) is still a job for a reader.
 *
 * What it cannot check is the interesting half: a comment may name something
 * real and still describe it wrongly. This only promises that the thing named
 * is there.
 */

/**
 * References that are right to name and right not to find.
 *
 * A comment is allowed to point outside the repository, and most of these do
 * it for the same reason: the file is real, but it is made rather than
 * written. Add to this with a reason, or the next person deletes a comment
 * that was telling the truth.
 */
const ALLOWED = [
  // Written at runtime, in the app's own data directory.
  ['accent.json', 'prefs, written per key on a phone'],
  ['downloads.json', "the download index, in the shell's data directory"],
  ['library.json', 'the library snapshot the phone keeps'],
  ['userData/secrets.json', 'the desktop keychain fallback'],
  ['userData/window.json', "the desktop window's last bounds"],

  // Objects in the bucket, which is not a checkout.
  ['format.json', "the bucket's own marker, written when one is connected"],
  [/^snapshots\/.*\.json$/, 'a snapshot key, shown as an example'],
  [/^log\/.*\.json$/, 'a log key, shown as an example'],

  // Build outputs, named by the thing that makes or consumes them.
  ['public/sw.js', 'built from sw/sw.ts at export'],
  ['privacy.html', 'published beside the app on GitHub Pages'],
  ['latest-mac.yml', 'attached to a release by electron-builder'],
  [/(^|\/)dist\/main\.cjs$/, 'the desktop main bundle, built before Playwright runs'],

  // Inside a dependency.
  ['src/NativeTrackPlayer.ts', "react-native-track-player's own TurboModule spec"],

  // Stand-ins in a sentence about a rule, not a file anybody can open.
  [/^(\.\/)?(foo|bar|x)(\.web|\.desktop)?\.(ts|tsx|js|mjs)$/, 'a placeholder in an explanation'],
]

const allowed = ref =>
  ALLOWED.some(([rule]) => (typeof rule === 'string' ? rule === ref : rule.test(ref)))

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const sources = tracked.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
const paths = new Set(tracked)

/**
 * A path names a file when the file's own path ends with it, or when the
 * segments it gives appear in order.
 *
 * The loose half is on purpose: comments write `replica/library.ts` for
 * `packages/replica/src/library.ts`, which is clear to a reader and should
 * not have to be spelled in full. A deleted file still matches nothing.
 */
const segmentsOf = p => p.replace(/^\.\//, '').split('/')
function resolves(ref) {
  const want = segmentsOf(ref)
  for (const file of paths) {
    if (file === ref || file.endsWith(`/${ref}`)) return true
    const have = file.split('/')
    let at = 0
    for (const part of have) if (part === want[at]) at++
    if (at === want.length) return true
  }
  return false
}

const BOARDS = new Set(
  readdirSync('docs/ui-mock/boards')
    .map(name => /^([A-Z]+\d+)-/.exec(name)?.[1])
    .filter(Boolean),
)

/**
 * Every `#member` the code declares or reaches, per file and overall.
 *
 * A `#name` in a comment is only read as a private member when its own file
 * has some: a `#` in prose is just as often a DOM id (`#menu`, YouTube's) or
 * CSS notation (`#rgb`), and neither is this script's business. Where a file
 * does use private members, one it names and no longer has is the rot worth
 * catching.
 */
const members = new Set()
const membersIn = new Map()
/** `this.#name` or `other.#name`, and a field or method declaring itself. */
const DECLARES =
  /\.(#[A-Za-z_$][\w$]*)|^\s*(?:readonly |static |async |get |set )*(#[A-Za-z_$][\w$]*)\s*[=(:;]/gm
for (const file of sources) {
  const own = new Set()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    for (const [, dotted, declared] of line.matchAll(DECLARES)) {
      const name = dotted ?? declared
      members.add(name)
      own.add(name)
    }
  }
  membersIn.set(file, own)
}

const EXT = '(?:tsx|ts|mjs|cjs|jsonc|json|js|md|html|css|yaml|yml|plist|sh|toml)'
const PATH = new RegExp(`[\`(]([A-Za-z0-9_@./-]+\\.${EXT})[\`),:;]`, 'g')
const BOARD = /`([A-Z]+\d{1,2})`/g
const MEMBER = /`(#[A-Za-z_$][\w$]*)`/g
/** `#fff`, `#rgb`, `#rrggbbaa`: CSS colour, written out or spelt out. */
const HEX = /^#(?:[0-9a-f]{3,8}|rgba?|rrggbb(?:aa)?)$/i

const found = []
for (const file of sources) {
  const lines = readFileSync(file, 'utf8').split('\n')
  for (const [index, line] of lines.entries()) {
    if (!/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) continue
    const at = `${file}:${index + 1}`
    for (const [, ref] of line.matchAll(PATH)) {
      if (ref.startsWith('http') || ref.startsWith('@') || ref.includes('.ts.net')) continue
      if (allowed(ref) || resolves(ref)) continue
      found.push({ at, ref, kind: 'no such file' })
    }
    for (const [, ref] of line.matchAll(BOARD)) {
      if (BOARDS.has(ref)) continue
      found.push({ at, ref, kind: 'no such mock board' })
    }
    for (const [, ref] of line.matchAll(MEMBER)) {
      if (HEX.test(ref) || members.has(ref)) continue
      if (membersIn.get(file).size === 0) continue
      found.push({ at, ref, kind: 'no such member' })
    }
  }
}

if (found.length === 0) {
  console.log('Every file, member and mock board a comment names is there.')
  process.exit(0)
}

console.error(
  `${found.length} comment${found.length === 1 ? '' : 's'} point${found.length === 1 ? 's' : ''} at something that is not there:\n`,
)
for (const { at, ref, kind } of found)
  console.error(`  ${ref.padEnd(46)} ${kind}\n  ${' '.repeat(46)} ${at}\n`)
console.error(
  'Point it at what the thing is called now, or say what replaced it.\n' +
    'If it is real but made rather than written — a runtime file, a bucket\n' +
    'object, a build output — add it to ALLOWED in this script with the reason.',
)
process.exit(1)

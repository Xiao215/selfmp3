/**
 * Which of two versions is newer, and where a version hides in a tag.
 *
 * Its own file, with nothing of Electron in it, so the root vitest can run it:
 * these two decide whether someone is told there is a new self.mp3, and that is
 * exactly the kind of rule that should not need an app to test.
 */

/** `desktop-v1.2.3` or `v1.2.3` or `1.2.3` — whatever the tag was called. */
export function versionFromTag(tag: string): string | null {
  return /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(tag)?.[1] ?? null
}

/**
 * Semver compare, enough of it: three numbers, and a prerelease suffix loses to
 * the release of the same numbers. Written rather than depended on, because the
 * whole use is "is that one newer than this one".
 */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (value: string): [number[], string] => {
    const [core = '', pre = ''] = value.split('-', 2)
    return [core.split('.').map(one => Number.parseInt(one, 10) || 0), pre]
  }
  const [a, aPre] = parts(candidate)
  const [b, bPre] = parts(current)
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left !== right) return left > right
  }
  if (aPre === bPre) return false
  // 1.2.0 beats 1.2.0-beta.1; 1.2.0-beta.2 beats 1.2.0-beta.1.
  if (aPre === '') return true
  if (bPre === '') return false
  return aPre > bPre
}

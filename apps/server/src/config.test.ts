import { describe, expect, it } from 'vitest'
import { defaultDirs } from './config.js'

/**
 * Where the library lands when nothing says otherwise.
 *
 * The thing these protect is not the paths themselves but the promise around
 * them: an existing checkout keeps the folders it already has, so upgrading
 * never looks like losing your music.
 */
describe('defaultDirs', () => {
  const never = (): boolean => false
  const always = (): boolean => true

  it('leaves a checkout that already has a library exactly where it is', () => {
    const dirs = defaultDirs('/repo', '/home/me', 'darwin', always)
    expect(dirs).toEqual({ libraryDir: '/repo/library', dataDir: '/repo/data' })
  })

  it('keeps the database with the music rather than splitting them', () => {
    // `data/` has no say of its own: it follows whichever home `library/` got.
    const old = defaultDirs('/repo', '/home/me', 'darwin', always)
    expect(old.dataDir.startsWith('/repo')).toBe(true)

    const fresh = defaultDirs('/repo', '/home/me', 'darwin', never)
    expect(fresh.dataDir.startsWith('/repo')).toBe(false)
  })

  it('puts a fresh install outside the checkout, in the places a Mac keeps such things', () => {
    const dirs = defaultDirs('/repo', '/Users/me', 'darwin', never)
    expect(dirs.libraryDir).toBe('/Users/me/Music/selfmp3')
    expect(dirs.dataDir).toBe('/Users/me/Library/Application Support/selfmp3')
  })

  it('follows the XDG-ish convention off macOS', () => {
    const dirs = defaultDirs('/repo', '/home/me', 'linux', never)
    expect(dirs.libraryDir).toBe('/home/me/Music/selfmp3')
    expect(dirs.dataDir).toBe('/home/me/.local/share/selfmp3')
  })

  it('never picks a path inside the checkout for a fresh install', () => {
    // The whole point: a git pull must not be able to touch your music, and a
    // second clone or a worktree must not come up as a different, empty library.
    const dirs = defaultDirs('/repo', '/home/me', 'darwin', never)
    expect(dirs.libraryDir.startsWith('/repo')).toBe(false)
    expect(dirs.dataDir.startsWith('/repo')).toBe(false)
  })
})

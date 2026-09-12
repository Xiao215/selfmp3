import { describe, expect, it } from 'vitest'
import { defaultDirs } from './config.js'

/**
 * Where the library lands when nothing says otherwise.
 *
 * The thing these protect is not the paths themselves but two promises: an
 * existing checkout keeps the folders it already has, so upgrading never looks
 * like losing your music; and a profile is a genuinely separate installation,
 * so working on the code cannot touch the collection you actually listen to.
 */
describe('defaultDirs', () => {
  const never = (): boolean => false
  const always = (): boolean => true

  it('leaves a checkout that already has a library exactly where it is', () => {
    const dirs = defaultDirs({ repoRoot: '/repo', home: '/home/me', exists: always })
    expect(dirs).toEqual({ libraryDir: '/repo/library', dataDir: '/repo/data' })
  })

  it('keeps the database with the music rather than splitting them', () => {
    // `data/` has no say of its own: it follows whichever home `library/` got.
    const old = defaultDirs({ repoRoot: '/repo', home: '/home/me', exists: always })
    expect(old.dataDir.startsWith('/repo')).toBe(true)

    const fresh = defaultDirs({ repoRoot: '/repo', home: '/home/me', exists: never })
    expect(fresh.dataDir.startsWith('/repo')).toBe(false)
  })

  it('puts a fresh install in the places a Mac keeps such things', () => {
    const dirs = defaultDirs({
      repoRoot: '/repo',
      home: '/Users/me',
      platform: 'darwin',
      exists: never,
    })
    expect(dirs.libraryDir).toBe('/Users/me/Music/selfmp3')
    expect(dirs.dataDir).toBe('/Users/me/Library/Application Support/selfmp3')
  })

  it('follows the XDG-ish convention off macOS', () => {
    const dirs = defaultDirs({
      repoRoot: '/repo',
      home: '/home/me',
      platform: 'linux',
      exists: never,
    })
    expect(dirs.libraryDir).toBe('/home/me/Music/selfmp3')
    expect(dirs.dataDir).toBe('/home/me/.local/share/selfmp3')
  })

  it('never picks a path inside the checkout for a fresh install', () => {
    // A git pull must not be able to touch your music.
    const dirs = defaultDirs({ repoRoot: '/repo', home: '/home/me', exists: never })
    expect(dirs.libraryDir.startsWith('/repo')).toBe(false)
    expect(dirs.dataDir.startsWith('/repo')).toBe(false)
  })

  describe('profiles', () => {
    it('gives a profile its own music and its own database', () => {
      const dirs = defaultDirs({
        repoRoot: '/repo',
        home: '/Users/me',
        platform: 'darwin',
        exists: never,
        profile: 'dev',
      })
      expect(dirs.libraryDir).toBe('/Users/me/Music/selfmp3-dev')
      expect(dirs.dataDir).toBe('/Users/me/Library/Application Support/selfmp3-dev')
    })

    it("ignores a checkout's own library, which is the point of asking", () => {
      // This is the whole mechanism: the cloud sign-in lives in the database
      // (repositories/cloud.ts keeps it in `secrets`), so a separate data
      // directory is what stops a dev server reaching the real bucket at all.
      const real = defaultDirs({ repoRoot: '/repo', home: '/Users/me', exists: always })
      const dev = defaultDirs({
        repoRoot: '/repo',
        home: '/Users/me',
        exists: always,
        profile: 'dev',
      })
      expect(real.dataDir).toBe('/repo/data')
      expect(dev.dataDir).not.toBe(real.dataDir)
      expect(dev.libraryDir).not.toBe(real.libraryDir)
    })

    it('does not let a profile name escape into a path', () => {
      const dirs = defaultDirs({
        repoRoot: '/repo',
        home: '/Users/me',
        platform: 'darwin',
        exists: never,
        profile: '../../etc',
      })
      expect(dirs.libraryDir).toBe('/Users/me/Music/selfmp3-etc')
    })

    it('treats an empty or unusable profile name as the real installation', () => {
      const plain = defaultDirs({ repoRoot: '/repo', home: '/Users/me', exists: never })
      for (const profile of ['', '   ', '-', '!!']) {
        expect(
          defaultDirs({ repoRoot: '/repo', home: '/Users/me', exists: never, profile }),
        ).toEqual(plain)
      }
    })
  })
})

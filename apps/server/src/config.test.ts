import { describe, expect, it } from 'vitest'
import { defaultDirs } from './config.js'

/**
 * Where the library lands when nothing says otherwise.
 *
 * The thing these protect is not the paths themselves but one promise: a
 * profile is a genuinely separate installation, so working on the code cannot
 * touch the collection you actually listen to.
 */
describe('defaultDirs', () => {
  it('puts the library in the places a Mac keeps such things', () => {
    const dirs = defaultDirs({ home: '/Users/me', platform: 'darwin' })
    expect(dirs.libraryDir).toBe('/Users/me/Music/selfmp3')
    expect(dirs.dataDir).toBe('/Users/me/Library/Application Support/selfmp3')
  })

  it('follows the XDG-ish convention off macOS', () => {
    const dirs = defaultDirs({ home: '/home/me', platform: 'linux' })
    expect(dirs.libraryDir).toBe('/home/me/Music/selfmp3')
    expect(dirs.dataDir).toBe('/home/me/.local/share/selfmp3')
  })

  describe('profiles', () => {
    it('gives a profile its own music and its own database', () => {
      // This is the whole mechanism: the cloud sign-in lives in the database
      // (repositories/cloud.ts keeps it in `secrets`), so a separate data
      // directory is what stops a dev server reaching the real bucket at all.
      const dirs = defaultDirs({ home: '/Users/me', platform: 'darwin', profile: 'dev' })
      expect(dirs.libraryDir).toBe('/Users/me/Music/selfmp3-dev')
      expect(dirs.dataDir).toBe('/Users/me/Library/Application Support/selfmp3-dev')
    })

    it('does not let a profile name escape into a path', () => {
      const dirs = defaultDirs({ home: '/Users/me', platform: 'darwin', profile: '../../etc' })
      expect(dirs.libraryDir).toBe('/Users/me/Music/selfmp3-etc')
    })

    it('treats an empty or unusable profile name as the real installation', () => {
      const plain = defaultDirs({ home: '/Users/me' })
      for (const profile of ['', '   ', '-', '!!']) {
        expect(defaultDirs({ home: '/Users/me', profile })).toEqual(plain)
      }
    })
  })
})

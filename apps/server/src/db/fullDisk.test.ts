import { describe, expect, it } from 'vitest'
import { fullDiskProblem } from './index.js'

/**
 * A server that cannot open its databases on a full disk says so, naming the
 * disk, where SQLite says only "disk I/O error" (R3-M9).
 */
describe('fullDiskProblem', () => {
  it('names the full disk and what to do', () => {
    // A filled APFS volume still reports a megabyte or so that no file can have.
    expect(fullDiskProblem('/data', () => 1_245_184)).toBe(
      'the disk holding /data is full (1245184 bytes free): free some space there and start the server again',
    )
  })

  it('says nothing when there is room, or the disk cannot be asked', () => {
    expect(fullDiskProblem('/data', () => 10 * 1024 ** 3)).toBeNull()
    expect(
      fullDiskProblem('/data', () => {
        throw new Error('ENOENT')
      }),
    ).toBeNull()
  })
})

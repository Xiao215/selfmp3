import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fullDiskProblem, keepRoomToStart, ROOM_TO_START_FILE } from './fullDisk.js'

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

/*
 * A server stopped hard while its disk was full could not start again: its
 * database's log has to be opened by writing the shared-memory file, and
 * there was no room for that (R3-M9, still so in R4). It keeps room aside
 * for that, and spends it.
 */
describe('keepRoomToStart', () => {
  const MB = 1024 * 1024
  const room = (dir: string) => path.join(dir, ROOM_TO_START_FILE)

  it('sets room aside when there is plenty, and spends it on a full disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-room-'))
    try {
      expect(keepRoomToStart(dir, () => 10 * 1024 * MB)).toBe(false)
      expect(fs.statSync(room(dir)).size).toBe(16 * MB)
      // Kept, not written again.
      expect(keepRoomToStart(dir, () => 10 * 1024 * MB)).toBe(false)

      expect(keepRoomToStart(dir, () => MB)).toBe(true)
      expect(fs.existsSync(room(dir))).toBe(false)
      // Spent: nothing more to spend until there is room again.
      expect(keepRoomToStart(dir, () => MB)).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not take the last of a disk with little room', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-room-'))
    try {
      expect(keepRoomToStart(dir, () => 20 * MB)).toBe(false)
      expect(fs.existsSync(room(dir))).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

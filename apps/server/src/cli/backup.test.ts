import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupTree, isSqliteDatabase, isSqliteScratch, shouldCopy } from './backup.js'

describe('shouldCopy', () => {
  const src = { size: 100, mtimeMs: 1_000_000 }

  it('copies when the destination is missing', () => {
    expect(shouldCopy(src, null)).toBe(true)
  })

  it('copies when the size differs', () => {
    expect(shouldCopy(src, { size: 99, mtimeMs: 1_000_000 })).toBe(true)
  })

  it('copies when the source is meaningfully newer', () => {
    expect(shouldCopy(src, { size: 100, mtimeMs: 900_000 })).toBe(true)
  })

  it('skips an identical or newer copy, tolerating mtime rounding', () => {
    expect(shouldCopy(src, { size: 100, mtimeMs: 1_000_000 })).toBe(false)
    expect(shouldCopy(src, { size: 100, mtimeMs: 999_000 })).toBe(false)
    expect(shouldCopy(src, { size: 100, mtimeMs: 2_000_000 })).toBe(false)
  })
})

describe('sqlite file names', () => {
  it('recognises databases and their scratch files', () => {
    expect(isSqliteDatabase('selfmp3.db')).toBe(true)
    expect(isSqliteDatabase('song.m4a')).toBe(false)
    expect(isSqliteScratch('selfmp3.db-wal')).toBe(true)
    expect(isSqliteScratch('selfmp3.db-shm')).toBe(true)
    expect(isSqliteScratch('selfmp3.db')).toBe(false)
  })
})

describe('backupTree', () => {
  let root: string
  let src: string
  let dest: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-backup-'))
    src = path.join(root, 'src')
    dest = path.join(root, 'dest')
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(src, 'a.m4a'), 'aaaa')
    fs.writeFileSync(path.join(src, 'sub', 'b.lrc'), 'bb')
    fs.writeFileSync(path.join(src, 'x.db-wal'), 'scratch')
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('copies everything the first time and nothing the second', async () => {
    const first = await backupTree(src, dest)
    expect(first).toEqual({ files: 2, copied: 2, bytes: 6, copiedBytes: 6 })
    expect(fs.readFileSync(path.join(dest, 'sub', 'b.lrc'), 'utf8')).toBe('bb')
    expect(fs.existsSync(path.join(dest, 'x.db-wal'))).toBe(false)

    const second = await backupTree(src, dest)
    expect(second).toEqual({ files: 2, copied: 0, bytes: 6, copiedBytes: 0 })
  })

  it('re-copies a file that changed and reports which', async () => {
    await backupTree(src, dest)
    fs.writeFileSync(path.join(src, 'a.m4a'), 'aaaaaaaa')
    const copied: string[] = []
    const summary = await backupTree(src, dest, relative => copied.push(relative))
    expect(copied).toEqual(['a.m4a'])
    expect(summary.copied).toBe(1)
    expect(fs.readFileSync(path.join(dest, 'a.m4a'), 'utf8')).toBe('aaaaaaaa')
  })

  it('never deletes from the destination', async () => {
    await backupTree(src, dest)
    fs.rmSync(path.join(src, 'a.m4a'))
    await backupTree(src, dest)
    expect(fs.existsSync(path.join(dest, 'a.m4a'))).toBe(true)
  })

  it('copies a database through the sqlite backup api', async () => {
    const { default: Database } = await import('better-sqlite3')
    const db = new Database(path.join(src, 'selfmp3.db'))
    db.exec('create table t (n integer); insert into t values (42)')
    db.close()

    const summary = await backupTree(src, dest)
    expect(summary.copied).toBe(3)
    const copy = new Database(path.join(dest, 'selfmp3.db'), { readonly: true })
    expect(copy.prepare('select n from t').get()).toEqual({ n: 42 })
    copy.close()

    // The database is measured after the copy: a live one keeps most of its
    // bytes in -wal, so the source size would under-report by a wide margin.
    const dbSize = fs.statSync(path.join(dest, 'selfmp3.db')).size
    expect(summary.bytes).toBe(6 + dbSize)
  })
})

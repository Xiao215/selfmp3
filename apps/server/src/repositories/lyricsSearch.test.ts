import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  LyricsSearchRepository,
  buildLyricsMatch,
  highlightMatch,
  tokenizeForFts,
} from './lyricsSearch.js'

/**
 * The query builder is exercised against a real in-memory FTS5 table, because
 * the whole point is that the expression it produces is valid and matches
 * inside a run of CJK characters — something a string assertion cannot prove.
 */

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE songs (id INTEGER PRIMARY KEY, missing INTEGER NOT NULL DEFAULT 0,
                        lyrics_kind TEXT NOT NULL DEFAULT 'none');
    CREATE VIRTUAL TABLE lyrics_fts USING fts5(
      song_id UNINDEXED, line_no UNINDEXED, line UNINDEXED, tokens,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE lyrics_index (
      song_id INTEGER PRIMARY KEY, hash TEXT NOT NULL,
      indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  return db
}

describe('tokenizeForFts', () => {
  it('separates every CJK character and leaves Latin words alone', () => {
    expect(tokenizeForFts('夜空 sky')).toBe('夜 空 sky')
    expect(tokenizeForFts('桜の風')).toBe('桜 の 風')
    expect(tokenizeForFts('  hello   world ')).toBe('hello world')
  })
})

describe('buildLyricsMatch', () => {
  it('quotes each word and adds a prefix star', () => {
    expect(buildLyricsMatch('hello wor')).toBe('"hello"* "wor"*')
  })

  it('turns a CJK run into a character phrase', () => {
    expect(buildLyricsMatch('夜空')).toBe('"夜 空"*')
  })

  it('neutralises FTS operators and quotes', () => {
    expect(buildLyricsMatch('a"b NEAR *')).toBe('"a""b"* "NEAR"* "*"*')
  })

  it('is null for an empty query', () => {
    expect(buildLyricsMatch('   ')).toBeNull()
  })
})

describe('highlightMatch', () => {
  it('splits around the whole query, case-insensitively', () => {
    expect(highlightMatch('Only the Music is awake', 'music')).toEqual({
      before: 'Only the ',
      match: 'Music',
      after: ' is awake',
    })
  })

  it('falls back to the longest matching word', () => {
    expect(highlightMatch('城市的灯都睡了', '灯都 xyz')).toEqual({
      before: '城市的',
      match: '灯都',
      after: '睡了',
    })
  })

  it('returns no match rather than guessing', () => {
    expect(highlightMatch('abc', 'zzz')).toEqual({ before: 'abc', match: '', after: '' })
  })
})

describe('LyricsSearchRepository', () => {
  it('finds CJK inside a line, Latin by prefix, and one hit per song', () => {
    const db = makeDb()
    db.exec(`INSERT INTO songs (id, lyrics_kind) VALUES (1, 'synced'), (2, 'plain'), (3, 'none')`)
    const repo = new LyricsSearchRepository(db)

    repo.replace(1, 'h1', ['夜空慢慢暗下来', '只有音乐还醒着', '晚安 夜空'])
    repo.replace(2, 'h2', ['桜の風が吹くとき', 'the music never stops'])

    expect(repo.search('夜空').map(row => row.song_id)).toEqual([1])
    expect(repo.search('音乐')[0]?.line).toBe('只有音乐还醒着')
    expect(repo.search('の風').map(row => row.song_id)).toEqual([2])
    expect(repo.search('musi').map(row => row.song_id)).toEqual([2])
    expect(repo.search('nothing here')).toEqual([])
    // A single Han character that appears in two songs still yields one row each.
    expect(repo.search('風').length).toBe(1)
  })

  it('tracks what was indexed and what is still missing', () => {
    const db = makeDb()
    db.exec(`INSERT INTO songs (id, lyrics_kind) VALUES (1, 'synced'), (2, 'plain'), (3, 'none')`)
    const repo = new LyricsSearchRepository(db)

    expect(repo.unindexedSongIds()).toEqual([1, 2])
    repo.replace(1, 'abc', ['line'])
    expect(repo.indexedHash(1)).toBe('abc')
    expect(repo.unindexedSongIds()).toEqual([2])

    repo.replace(1, 'def', ['other'])
    expect(repo.search('line')).toEqual([])
    expect(repo.search('other').map(row => row.song_id)).toEqual([1])

    repo.remove(1)
    expect(repo.indexedHash(1)).toBeNull()
    expect(repo.search('other')).toEqual([])
  })

  it('never throws on hostile input', () => {
    const repo = new LyricsSearchRepository(makeDb())
    expect(repo.search('"')).toEqual([])
    expect(repo.search('AND OR NOT')).toEqual([])
    expect(repo.search('')).toEqual([])
  })
})

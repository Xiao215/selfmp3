import { describe, expect, it } from 'vitest'
import { isRoomRefusal, type RoomRefusal } from './room.js'
import {
  addSharedMember,
  applySharedAction,
  canReadSharedEntry,
  newSharedDoc,
  sharedSummary,
} from './sharedPlaylist.js'
import type { RoomSong } from './schemas/room.js'
import type { SharedAction, SharedDoc } from './schemas/shared.js'

/**
 * A shared playlist's rules: anyone in it adds their own songs, takes out
 * their own, and leaving takes your songs with you.
 */

const X = 'aaaaaaaaaaaa'
const M = 'bbbbbbbbbbbb'

function song(n: number): RoomSong {
  const sha = n.toString(16).padStart(2, '0').repeat(32)
  return {
    uid: sha.slice(0, 32),
    title: `Song ${n}`,
    artist: '',
    album: '',
    duration: 100,
    audio: { key: `audio/${sha}.m4a`, size: 1, mime: 'audio/mp4' },
    cover: null,
    coverTone: null,
    lyrics: null,
    sourceUrl: null,
    link: null,
    artwork: null,
  }
}

let ids = 0
const newId = (): string => (++ids).toString(16).padStart(12, '0')

function ok(value: SharedDoc | RoomRefusal): SharedDoc {
  if (isRoomRefusal(value)) throw new Error(value.message)
  return value
}

function playlist(): SharedDoc {
  const doc = newSharedDoc({
    id: '0123456789abcdef',
    name: 'Saturday with Mia',
    creator: { id: X, name: 'Xiao', picture: null },
    songs: [{ id: newId(), song: song(1) }],
    now: 1000,
  })
  return ok(addSharedMember(doc, { id: M, name: 'Mia', picture: null }, 2000))
}

const act = (doc: SharedDoc, who: string, action: SharedAction): SharedDoc =>
  ok(applySharedAction(doc, who, action, 3000, newId))

describe('a shared playlist', () => {
  it('takes anyone’s own songs, and shows who brought each', () => {
    const doc = act(playlist(), M, { type: 'add', song: song(2) })
    expect(doc.entries.map(entry => [entry.song.title, entry.owner])).toEqual([
      ['Song 1', X],
      ['Song 2', M],
    ])
    expect(doc.members.map(member => member.colour)).toEqual([0, 1])
  })

  it('lets you take out your own songs, and whoever made it anyone’s', () => {
    const doc = act(playlist(), M, { type: 'add', song: song(2) })
    const [xiaos, mias] = doc.entries
    expect(
      applySharedAction(doc, M, { type: 'remove', entryId: xiaos?.id ?? '' }, 3000, newId),
    ).toMatchObject({
      refused: 'forbidden',
    })
    expect(act(doc, X, { type: 'remove', entryId: mias?.id ?? '' }).entries).toHaveLength(1)
  })

  it('is renamed only by whoever made it', () => {
    expect(
      applySharedAction(playlist(), M, { type: 'rename', name: 'Mine' }, 3000, newId),
    ).toMatchObject({
      refused: 'forbidden',
    })
    expect(act(playlist(), X, { type: 'rename', name: 'Late' }).name).toBe('Late')
  })

  it('loses your songs when you leave, and hands on who made it', () => {
    let doc = act(playlist(), M, { type: 'add', song: song(2) })
    doc = act(doc, X, { type: 'leave' })
    expect(doc.members).toMatchObject([{ id: M, creator: true }])
    expect(doc.entries.map(entry => entry.owner)).toEqual([M])
  })

  it('lends a song’s files only to its people', () => {
    const doc = playlist()
    const entry = doc.entries[0]?.id ?? ''
    expect(canReadSharedEntry(doc, M, entry)?.owner).toBe(X)
    expect(canReadSharedEntry(doc, 'cccccccccccc', entry)).toBeNull()
  })

  it('holds a song once', () => {
    expect(
      applySharedAction(playlist(), M, { type: 'add', song: song(1) }, 3000, newId),
    ).toMatchObject({
      refused: 'invalid',
    })
  })

  it('moves a song', () => {
    let doc = act(playlist(), M, { type: 'add', song: song(2) })
    doc = act(doc, X, { type: 'move', entryId: doc.entries[1]?.id ?? '', to: 0 })
    expect(doc.entries.map(entry => entry.song.title)).toEqual(['Song 2', 'Song 1'])
  })

  it('sums itself up for a list', () => {
    expect(sharedSummary(playlist())).toMatchObject({
      name: 'Saturday with Mia',
      songs: 1,
      people: [{ name: 'Xiao' }, { name: 'Mia' }],
    })
  })
})

import {
  ShareLinkSchema,
  ShareSummariesSchema,
  SHARE_IDLE_MS,
  SHARE_KEPT_MS,
  SHARE_LIMIT_MS,
  type RoomFilePart,
  type RoomSong,
  type ShareLink,
} from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { harness, type Harness } from './fakes.js'

/**
 * Share links, as the doorman keeps them (docs/features/share-links.md):
 * played from the sender's bucket by anyone with the link, for a week from
 * the last play and a month at most; then a card that can be asked about,
 * shared again, and in ninety days forgotten.
 */

const DAY = 24 * 60 * 60 * 1000

const MIA = {
  sub: '208234567890123456789',
  email: 'friend@example.com',
  name: 'Mia Chen',
  picture: 'https://lh3.googleusercontent.com/a/mia',
}

function song(n: number): RoomSong {
  const sha = n.toString(16).padStart(2, '0').repeat(32)
  return {
    uid: sha.slice(0, 32),
    title: `Song ${n}`,
    artist: 'Someone',
    album: '',
    duration: 100,
    audio: { key: `audio/${sha}.m4a`, size: 3, mime: 'audio/mp4' },
    cover: { key: `covers/${sha}.jpg`, size: 7 },
    coverTone: null,
    lyrics: null,
    sourceUrl: `https://www.youtube.com/watch?v=${'a'.repeat(10)}${n}`,
    link: null,
    artwork: null,
  }
}

interface Setup {
  h: Harness
  me: string
  mia: string
}

async function setup(): Promise<Setup> {
  const h = harness()
  h.allow({ anyone: true })
  const me = await h.signIn()
  const mia = await h.signIn(MIA)
  expect((await h.connect(me, { prefix: 'selfmp3' })).status).toBe(200)
  for (const n of [1, 2]) {
    h.bucket.put(`selfmp3/${song(n).audio?.key}`, `song ${n}`)
    h.bucket.put(`selfmp3/${song(n).cover?.key}`, `cover ${n}`)
  }
  return { h, me, mia }
}

async function link(response: Response): Promise<ShareLink> {
  expect(response.status).toBe(200)
  return ShareLinkSchema.parse(await response.json())
}

async function make(
  s: Setup,
  songs = [song(1)],
  name = songs[0]?.title ?? '',
  kind: 'song' | 'list' = 'song',
): Promise<ShareLink> {
  return link(
    await s.h.call('/v1/share', {
      token: s.me,
      json: { name, kind, you: 'Xiao', songs },
    }),
  )
}

const open = (s: Setup, made: ShareLink, token?: string, key = made.key) =>
  s.h.call(`/v1/share/${made.id}?k=${key}`, { token })

/** A song's file, and the play it writes down after the answer (`waitUntil`) written. */
async function file(s: Setup, made: ShareLink, part: RoomFilePart, headers = {}) {
  const answer = await s.h.call(
    `/v1/share/${made.id}/files/${made.entries[0]?.id ?? ''}/${part}?k=${made.key}`,
    { headers },
  )
  await s.h.settle()
  return answer
}

describe('a share link', () => {
  it('is made signed in, with a bucket, and opens for anyone with its key', async () => {
    const s = await setup()
    const made = await make(s)
    expect(made.yours).toBe(true)
    expect(made.from).toEqual({ name: 'Xiao', picture: 'https://lh3.googleusercontent.com/a/me' })
    expect(made.endsAt).toBe(s.h.clock.now + SHARE_IDLE_MS)

    // Mia has no bucket, so there is nothing to lend from.
    const without = await s.h.call('/v1/share', {
      token: s.mia,
      json: { name: 'x', kind: 'song', you: 'Mia', songs: [song(1)] },
    })
    expect(without.status).toBe(409)

    const guest = await link(await open(s, made))
    expect(guest.yours).toBe(false)
    expect(guest.entries.map(entry => entry.song.title)).toEqual(['Song 1'])
    expect((await open(s, made, undefined, '0'.repeat(16))).status).toBe(403)
    expect(await (await file(s, made, 'audio')).text()).toBe('song 1')
  })

  it('says its sender is out of their daily quota when their bucket is capped', async () => {
    const s = await setup()
    const made = await make(s)
    s.h.bucket.capped = true
    for (const part of ['audio', 'cover'] as const) {
      const answer = await file(s, made, part)
      expect(answer.status).toBe(502)
      // Not the sender's Backblaze advice, and not the code that holds a device's own bucket.
      expect(await answer.json()).toMatchObject({
        code: 'lender_cap_exceeded',
        error: 'Whoever sent it has run out of their daily quota',
      })
    }
  })

  it('upgrades a link kept before its guests were counted the first time it is read', async () => {
    const s = await setup()
    const made = await make(s)
    const stored = s.h.shares.stored(made.id)
    const secrets = stored.get('secrets') as Record<string, unknown>
    delete secrets['visitors']
    stored.set('secrets', secrets)
    await s.h.call(`/v1/share/${made.id}?k=${made.key}&v=device-1`)
    expect((stored.get('secrets') as { visitors?: unknown }).visitors).toEqual(['device-1'])
    expect((await link(await open(s, made, s.me))).guests).toBe(1)
  })

  it('tells its sender who opened it and how often it played, and nobody else', async () => {
    const s = await setup()
    const made = await make(s)
    await open(s, made)
    // The same signed-out device looking twice is one guest.
    await s.h.call(`/v1/share/${made.id}?k=${made.key}&v=device-1`)
    await s.h.call(`/v1/share/${made.id}?k=${made.key}&v=device-1`)
    const mias = await link(await open(s, made, s.mia))
    expect(mias.opened).toEqual([])
    await file(s, made, 'audio')
    // A piece from the middle is the same play.
    await file(s, made, 'audio', { range: 'bytes=2-' })
    const mine = await link(await open(s, made, s.me))
    expect(mine.opened).toEqual(['Mia'])
    expect(mine.guests).toBe(2)
    expect(mine.plays).toBe(1)

    const sent = ShareSummariesSchema.parse(
      await (await s.h.call('/v1/share', { token: s.me })).json(),
    )
    expect(sent.map(item => [item.name, item.songs, item.cover])).toEqual([
      ['Song 1', 1, made.entries[0]?.id],
    ])
    // The song too, so a device that has it draws its own copy's cover.
    expect(sent[0]?.coverSong).toEqual(song(1))
    const received = ShareSummariesSchema.parse(
      await (await s.h.call('/v1/share/received', { token: s.mia })).json(),
    )
    expect(received.map(item => [item.id, item.yours, item.plays])).toEqual([[made.id, false, 0]])
  })

  it('is the same link when the same songs are shared again under the same name', async () => {
    const s = await setup()
    const made = await make(s, [song(1), song(2)], 'Chill', 'list')
    await open(s, made, s.mia)
    // In any order, and with nothing counted as an opening.
    const again = await make(s, [song(2), song(1)], 'Chill', 'list')
    expect([again.id, again.key]).toEqual([made.id, made.key])
    expect(again.opened).toEqual(['Mia'])
    const sent = ShareSummariesSchema.parse(
      await (await s.h.call('/v1/share', { token: s.me })).json(),
    )
    expect(sent.map(item => item.id)).toEqual([made.id])

    // Other songs, or another name, are another link.
    expect((await make(s, [song(1)], 'Chill', 'list')).id).not.toBe(made.id)
    expect((await make(s, [song(1), song(2)], 'Mix', 'list')).id).not.toBe(made.id)
  })

  it('lends a song’s files by their names now when it is shared again', async () => {
    const s = await setup()
    const words = (name: string): RoomSong => ({
      ...song(1),
      lyrics: { key: `lyrics/${'01'.repeat(32)}.${name}`, size: 5, kind: 'synced' },
    })
    s.h.bucket.put(`selfmp3/lyrics/${'01'.repeat(32)}.words`, 'words')
    const made = await make(s, [words('lrc')])
    // Its words were rewritten into another file since it was shared.
    expect((await file(s, made, 'lyrics')).status).toBe(404)
    const again = await make(s, [words('words')])
    expect(again.id).toBe(made.id)
    expect(await (await file(s, made, 'lyrics')).text()).toBe('words')
  })

  it('shares the same link again once it ran out, but not once its sender ended it', async () => {
    const s = await setup()
    const made = await make(s)
    s.h.clock.now += SHARE_IDLE_MS
    expect((await file(s, made, 'audio')).status).toBe(410)
    const renewed = await make(s)
    expect(renewed.id).toBe(made.id)
    expect(renewed.ended).toBeNull()
    expect(renewed.limitAt).toBe(s.h.clock.now + SHARE_LIMIT_MS)
    expect((await file(s, made, 'audio')).status).toBe(200)

    await s.h.call(`/v1/share/${made.id}/act`, { token: s.me, json: { type: 'end' } })
    const fresh = await make(s)
    expect(fresh.id).not.toBe(made.id)
    expect((await file(s, made, 'audio')).status).toBe(410)
    // The new one is the one given back from now on; one forgotten is not.
    expect((await make(s)).id).toBe(fresh.id)
    await s.h.call(`/v1/share/${fresh.id}/act`, { token: s.me, json: { type: 'forget' } })
    expect((await make(s)).id).not.toBe(fresh.id)
  })

  it('is still the same link after its sender shared it again from its card', async () => {
    const s = await setup()
    const made = await make(s)
    // Ran out after a week; shared again from its card near the end of its ninety days.
    s.h.clock.now += SHARE_IDLE_MS + SHARE_KEPT_MS - DAY
    const renewed = await s.h.call(`/v1/share/${made.id}/act`, {
      token: s.me,
      json: { type: 'renew' },
    })
    expect(renewed.status).toBe(200)
    // Past when the way back to it, put when it was made, would have run out.
    s.h.clock.now += SHARE_LIMIT_MS
    expect((await make(s)).id).toBe(made.id)
  })

  it('lasts a week from the last play, and a month at most', async () => {
    const s = await setup()
    const made = await make(s)
    for (let day = 6; day < 30; day += 6) {
      s.h.clock.now += 6 * DAY
      expect((await file(s, made, 'audio')).status).toBe(200)
    }
    const playing = await link(await open(s, made))
    expect(playing.ended).toBeNull()
    expect(playing.endsAt).toBe(made.createdAt + SHARE_LIMIT_MS)

    s.h.clock.now = made.createdAt + SHARE_LIMIT_MS
    const ended = await link(await open(s, made))
    expect(ended.ended).toEqual({ at: made.createdAt + SHARE_LIMIT_MS, why: 'limit' })
    expect((await file(s, made, 'audio')).status).toBe(410)
    // The card keeps its cover.
    expect(await (await file(s, made, 'cover')).text()).toBe('cover 1')
  })

  it('can be asked for again once it ended, and shared again, the same link', async () => {
    const s = await setup()
    const made = await make(s)
    await open(s, made, s.mia)
    const early = await s.h.call(`/v1/share/${made.id}/ask?k=${made.key}`, {
      json: { name: 'Ken' },
    })
    expect(early.status).toBe(400)

    s.h.clock.now += SHARE_IDLE_MS
    const asked = await link(
      await s.h.call(`/v1/share/${made.id}/ask?k=${made.key}`, {
        token: s.mia,
        json: { name: 'Anything' },
      }),
    )
    expect(asked.asked).toBe(true)
    await s.h.call(`/v1/share/${made.id}/ask?k=${made.key}`, { json: { name: 'Ken' } })
    await s.h.call(`/v1/share/${made.id}/ask?k=${made.key}`, { json: { name: 'ken' } })
    const mine = await link(await open(s, made, s.me))
    expect(mine.ended?.why).toBe('idle')
    // Signed in, you ask as yourself; the same name twice is one ask.
    expect(mine.asks.map(ask => ask.name)).toEqual(['Mia', 'ken'])
    expect((await link(await open(s, made, s.mia))).asked).toBe(true)

    const notYours = await s.h.call(`/v1/share/${made.id}/act`, {
      token: s.mia,
      json: { type: 'renew' },
    })
    expect(notYours.status).toBe(403)
    const renewed = await link(
      await s.h.call(`/v1/share/${made.id}/act`, { token: s.me, json: { type: 'renew' } }),
    )
    expect(renewed.ended).toBeNull()
    expect(renewed.asks).toEqual([])
    expect((await link(await open(s, made, s.mia))).asked).toBe(false)
    expect((await file(s, made, 'audio')).status).toBe(200)
  })

  it('is ended by its sender at once', async () => {
    const s = await setup()
    const made = await make(s)
    await s.h.call(`/v1/share/${made.id}/act`, { token: s.me, json: { type: 'end' } })
    const ended = await link(await open(s, made))
    expect(ended.ended).toEqual({ at: s.h.clock.now, why: 'stopped' })
    expect((await file(s, made, 'audio')).status).toBe(410)
  })

  it('ends when its songs leave the sender’s bucket, and cannot be asked for then', async () => {
    const s = await setup()
    const made = await make(s)
    s.h.bucket.objects.delete(`selfmp3/${song(1).audio?.key}`)
    expect((await file(s, made, 'audio')).status).toBe(404)
    const ended = await link(await open(s, made))
    expect(ended.ended?.why).toBe('removed')
    expect(ended.entries[0]?.gone).toBe(true)
    const ask = await s.h.call(`/v1/share/${made.id}/ask?k=${made.key}`, { json: { name: 'Ken' } })
    expect(ask.status).toBe(410)
    const renew = await s.h.call(`/v1/share/${made.id}/act`, {
      token: s.me,
      json: { type: 'renew' },
    })
    expect(renew.status).toBe(410)
  })

  it('comes off a list when forgotten, and is gone for everyone when its sender forgets it', async () => {
    const s = await setup()
    const made = await make(s)
    await open(s, made, s.mia)
    await s.h.call(`/v1/share/${made.id}/act`, { token: s.mia, json: { type: 'forget' } })
    const received = await (await s.h.call('/v1/share/received', { token: s.mia })).json()
    expect(received).toEqual([])
    // Still there for its sender and anyone with the link.
    expect((await open(s, made)).status).toBe(200)

    await s.h.call(`/v1/share/${made.id}/act`, { token: s.me, json: { type: 'forget' } })
    expect((await open(s, made)).status).toBe(404)
    expect(await (await s.h.call('/v1/share', { token: s.me })).json()).toEqual([])
  })

  it('is forgotten ninety days after it ended', async () => {
    const s = await setup()
    const made = await make(s)
    s.h.clock.now += SHARE_IDLE_MS + SHARE_KEPT_MS - 1
    await s.h.shares.runAlarms()
    expect((await open(s, made)).status).toBe(200)
    s.h.clock.now += 1
    await s.h.shares.runAlarms()
    expect(s.h.shares.stored(made.id).size).toBe(0)
    expect((await open(s, made)).status).toBe(404)
  })
})

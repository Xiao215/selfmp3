import {
  RoomJoinedSchema,
  RoomStateSchema,
  SharedPlaylistSchema,
  SharedSummariesSchema,
  type RoomSong,
  type SharedPlaylist,
} from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { ME, harness, type Harness } from './fakes.js'

/**
 * Shared playlists, as the doorman keeps them: on every device of everyone in
 * them, each song lent from its owner's bucket for as long as it is in it.
 */

const MIA = {
  sub: '208234567890123456789',
  email: 'friend@example.com',
  name: 'Mia',
  picture: 'https://lh3.googleusercontent.com/a/mia',
}
const KEN = { sub: '308234567890123456789', email: 'ken@example.com', name: 'Ken' }

function song(n: number): RoomSong {
  const sha = n.toString(16).padStart(2, '0').repeat(32)
  return {
    uid: sha.slice(0, 32),
    title: `Song ${n}`,
    artist: '',
    album: '',
    duration: 100,
    audio: { key: `audio/${sha}.m4a`, size: 3, mime: 'audio/mp4' },
    cover: null,
    coverTone: null,
    lyrics: null,
    sourceUrl: null,
    link: null,
    artwork: null,
  }
}

interface Setup {
  h: Harness
  me: string
  mia: string
  ken: string
}

async function setup(): Promise<Setup> {
  const h = harness()
  h.allow({ anyone: true })
  const me = await h.signIn()
  const mia = await h.signIn(MIA)
  const ken = await h.signIn(KEN)
  for (const [token, prefix] of [
    [me, 'selfmp3'],
    [mia, 'mia'],
    [ken, 'ken'],
  ] as const) {
    expect((await h.connect(token, { prefix })).status).toBe(200)
  }
  h.bucket.put(`selfmp3/${song(1).audio?.key}`, 'one')
  h.bucket.put(`mia/${song(2).audio?.key}`, 'two')
  return { h, me, mia, ken }
}

async function playlist(response: Response): Promise<SharedPlaylist> {
  expect(response.status).toBe(200)
  return SharedPlaylistSchema.parse(await response.json())
}

async function make(s: Setup): Promise<SharedPlaylist> {
  return playlist(
    await s.h.call('/v1/shared', {
      token: s.me,
      json: { name: 'Saturday', you: 'Xiao', songs: [song(1)] },
    }),
  )
}

describe('a shared playlist', () => {
  it('is joined with its invite, and is on the list of everyone in it', async () => {
    const s = await setup()
    const made = await make(s)
    const refused = await s.h.call(`/v1/shared/${made.id}/join`, {
      token: s.mia,
      json: { invite: '0'.repeat(16), name: 'Mia' },
    })
    expect(refused.status).toBe(403)
    const joined = await playlist(
      await s.h.call(`/v1/shared/${made.id}/join`, {
        token: s.mia,
        json: { invite: made.invite, name: 'Mia' },
      }),
    )
    expect(joined.members.map(member => member.name)).toEqual(['Xiao', 'Mia'])
    const list = SharedSummariesSchema.parse(
      await (await s.h.call('/v1/shared', { token: s.mia })).json(),
    )
    expect(list.map(item => [item.name, item.songs])).toEqual([['Saturday', 1]])
    // Ken was never asked.
    expect((await s.h.call(`/v1/shared/${made.id}`, { token: s.ken })).status).toBe(403)
  })

  it('lends each song from its owner’s bucket to its people, and only to them', async () => {
    const s = await setup()
    const made = await make(s)
    const mia = await playlist(
      await s.h.call(`/v1/shared/${made.id}/join`, {
        token: s.mia,
        json: { invite: made.invite, name: 'Mia' },
      }),
    )
    const added = await playlist(
      await s.h.call(`/v1/shared/${made.id}/act`, {
        token: s.mia,
        json: { type: 'add', song: song(2) },
      }),
    )
    const [xiaos, mias] = added.entries
    const read = (entry: string, token: string) =>
      s.h.call(`/v1/shared/${made.id}/files/${entry}/audio?t=${token}`)
    expect(await (await read(mias?.id ?? '', made.token)).text()).toBe('two')
    expect(await (await read(xiaos?.id ?? '', mia.token)).text()).toBe('one')
    expect((await read(xiaos?.id ?? '', '0'.repeat(32))).status).toBe(401)
  })

  it('takes your songs with you when you leave, and is forgotten when everyone has', async () => {
    const s = await setup()
    const made = await make(s)
    await s.h.call(`/v1/shared/${made.id}/join`, {
      token: s.mia,
      json: { invite: made.invite, name: 'Mia' },
    })
    expect(
      (await s.h.call(`/v1/shared/${made.id}/act`, { token: s.me, json: { type: 'leave' } }))
        .status,
    ).toBe(204)
    const left = await playlist(await s.h.call(`/v1/shared/${made.id}`, { token: s.mia }))
    expect(left.entries).toEqual([])
    expect(left.members).toMatchObject([{ name: 'Mia', creator: true }])
    expect(await (await s.h.call('/v1/shared', { token: s.me })).json()).toEqual([])
    await s.h.call(`/v1/shared/${made.id}/act`, { token: s.mia, json: { type: 'leave' } })
    expect(s.h.shared.stored(made.id).size).toBe(0)
  })

  it('shows each person’s Google picture from their session, never from what they send', async () => {
    const s = await setup()
    const elsewhere = 'https://example.com/someone-else.png'
    const made = await playlist(
      await s.h.call('/v1/shared', {
        token: s.me,
        json: { name: 'Saturday', you: 'Xiao', songs: [], picture: elsewhere },
      }),
    )
    const joined = await playlist(
      await s.h.call(`/v1/shared/${made.id}/join`, {
        token: s.mia,
        json: { invite: made.invite, name: 'Mia', picture: elsewhere },
      }),
    )
    expect(joined.members.map(member => member.picture)).toEqual([ME.picture, MIA.picture])
    const list = SharedSummariesSchema.parse(
      await (await s.h.call('/v1/shared', { token: s.mia })).json(),
    )
    expect(list[0]?.people.map(person => person.picture)).toEqual([ME.picture, MIA.picture])
  })

  it('upgrades a playlist kept before faces had pictures the first time it is read', async () => {
    const s = await setup()
    const made = await make(s)
    const stored = s.h.shared.stored(made.id)
    const doc = stored.get('doc') as { members: Record<string, unknown>[] }
    for (const member of doc.members) delete member.picture
    stored.set('doc', doc)
    // A list reads it without anyone's session picture: the upgrade alone.
    const list = SharedSummariesSchema.parse(
      await (await s.h.call('/v1/shared', { token: s.me })).json(),
    )
    expect(list.map(each => each.people.map(person => person.picture))).toEqual([[null]])
    const kept = stored.get('doc') as { members: { picture?: string | null }[] }
    expect(kept.members.map(member => member.picture)).toEqual([null])
  })

  it('gives someone kept from before faces had pictures theirs when they next look', async () => {
    const s = await setup()
    const made = await make(s)
    const stored = s.h.shared.stored(made.id)
    const doc = stored.get('doc') as { members: Record<string, unknown>[] }
    for (const member of doc.members) delete member.picture
    stored.set('doc', doc)
    const looked = await playlist(await s.h.call(`/v1/shared/${made.id}`, { token: s.me }))
    expect(looked.members.map(member => member.picture)).toEqual([ME.picture])
    const kept = stored.get('doc') as { members: { picture?: string | null }[] }
    expect(kept.members[0]?.picture).toBe(ME.picture)
  })

  it('keeps no account and no token where its people can see', async () => {
    const s = await setup()
    const made = await make(s)
    const seen = JSON.stringify(made)
    expect(seen).not.toContain('108234567890123456789')
    expect(seen).not.toContain(s.me)
  })
})

describe('a room and a shared playlist', () => {
  async function room(s: Setup) {
    const opened = await s.h.call('/v1/rooms', {
      token: s.me,
      json: { name: 'Xiao', mode: 'speaker' },
    })
    const host = RoomJoinedSchema.parse(await opened.json())
    const joined = await s.h.call(`/v1/rooms/${host.code}/join`, {
      token: s.mia,
      json: { name: 'Mia' },
    })
    const mia = RoomJoinedSchema.parse(await joined.json())
    return { host, mia }
  }

  it('keeps the room as a shared playlist that everyone signed in has', async () => {
    const s = await setup()
    const { host, mia } = await room(s)
    await s.h.call(`/v1/rooms/${host.code}/act?t=${mia.token}`, {
      token: s.mia,
      json: { type: 'add', song: song(2) },
    })
    const ana = await s.h.call(`/v1/rooms/${host.code}/join`, { json: { name: 'Ana' } })
    expect(ana.status).toBe(200)

    const kept = await playlist(
      await s.h.call(`/v1/rooms/${host.code}/keep?t=${host.token}`, {
        token: s.me,
        json: { name: 'With Mia' },
      }),
    )
    // Ana joined with only a name: there is no account to give it to.
    expect(kept.members.map(member => [member.name, member.creator, member.picture])).toEqual([
      ['Xiao', true, ME.picture],
      ['Mia', false, MIA.picture],
    ])
    expect(kept.entries.map(entry => entry.song.title)).toEqual(['Song 2'])
    const hers = SharedSummariesSchema.parse(
      await (await s.h.call('/v1/shared', { token: s.mia })).json(),
    )
    expect(hers.map(item => item.name)).toEqual(['With Mia'])
    // Only the host keeps it.
    const refused = await s.h.call(`/v1/rooms/${host.code}/keep?t=${mia.token}`, {
      token: s.mia,
      json: { name: 'Mine' },
    })
    expect(refused.status).toBe(403)
  })

  it('plays a shared playlist in a room, lent from owners who are not there', async () => {
    const s = await setup()
    const made = await make(s)
    await s.h.call(`/v1/shared/${made.id}/join`, {
      token: s.mia,
      json: { invite: made.invite, name: 'Mia' },
    })
    await s.h.call(`/v1/shared/${made.id}/act`, {
      token: s.mia,
      json: { type: 'add', song: song(2) },
    })

    const opened = await s.h.call('/v1/rooms', {
      token: s.me,
      json: { name: 'Xiao', mode: 'speaker' },
    })
    const host = RoomJoinedSchema.parse(await opened.json())
    const filled = RoomStateSchema.parse(
      await (
        await s.h.call(`/v1/rooms/${host.code}/from-shared?t=${host.token}`, {
          token: s.me,
          json: { shared: made.id },
        })
      ).json(),
    )
    expect(filled.entries.map(entry => [entry.song.title, entry.from, entry.fromPicture])).toEqual([
      ['Song 1', 'Xiao', ME.picture],
      ['Song 2', 'Mia', MIA.picture],
    ])
    const mias = filled.entries[1]?.id ?? ''
    const played = await s.h.call(`/v1/rooms/${host.code}/files/${mias}/audio?t=${host.token}`)
    expect(await played.text()).toBe('two')

    // Someone joining keeps the room's lending as it was.
    const ana = await s.h.call(`/v1/rooms/${host.code}/join`, { json: { name: 'Ana' } })
    const guest = RoomJoinedSchema.parse(await ana.json())
    const again = await s.h.call(`/v1/rooms/${host.code}/files/${mias}/audio?t=${guest.token}`)
    expect(await again.text()).toBe('two')

    // Someone not in the playlist cannot fill a room from it.
    const kens = await s.h.call('/v1/rooms', {
      token: s.ken,
      json: { name: 'Ken', mode: 'speaker' },
    })
    const ken = RoomJoinedSchema.parse(await kens.json())
    const refused = await s.h.call(`/v1/rooms/${ken.code}/from-shared?t=${ken.token}`, {
      token: s.ken,
      json: { shared: made.id },
    })
    expect(refused.status).toBe(403)
  })

  it('stops lending a song once it is out of the playlist, or its owner is', async () => {
    const s = await setup()
    const made = await make(s)
    await s.h.call(`/v1/shared/${made.id}/join`, {
      token: s.mia,
      json: { invite: made.invite, name: 'Mia' },
    })
    s.h.bucket.put(`mia/${song(3).audio?.key}`, 'three')
    for (const n of [2, 3]) {
      await s.h.call(`/v1/shared/${made.id}/act`, {
        token: s.mia,
        json: { type: 'add', song: song(n) },
      })
    }
    const kept = await playlist(await s.h.call(`/v1/shared/${made.id}`, { token: s.mia }))
    const { host } = await room(s)
    const filled = RoomStateSchema.parse(
      await (
        await s.h.call(`/v1/rooms/${host.code}/from-shared?t=${host.token}`, {
          token: s.me,
          json: { shared: made.id },
        })
      ).json(),
    )
    const entry = (title: string) =>
      filled.entries.find(item => item.song.title === title && item.owner === null)?.id ?? ''
    const read = (title: string) =>
      s.h.call(`/v1/rooms/${host.code}/files/${entry(title)}/audio?t=${host.token}`)
    expect(await (await read('Song 2')).text()).toBe('two')

    // Mia takes Song 2 out: the room no longer has it to lend.
    const two = kept.entries.find(item => item.song.title === 'Song 2')?.id ?? ''
    await s.h.call(`/v1/shared/${made.id}/act`, {
      token: s.mia,
      json: { type: 'remove', entryId: two },
    })
    expect((await read('Song 2')).status).toBe(404)
    expect(await (await read('Song 3')).text()).toBe('three')

    // Mia leaves: none of hers are lent any more.
    await s.h.call(`/v1/shared/${made.id}/act`, { token: s.mia, json: { type: 'leave' } })
    expect((await read('Song 3')).status).toBe(404)
    expect(await (await read('Song 1')).text()).toBe('one')
  })
})

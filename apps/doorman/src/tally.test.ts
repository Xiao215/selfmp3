import {
  DOORMAN_PATHS,
  DoormanAccessRequestsSchema,
  DoormanAccessSchema,
  DoormanGrantMadeSchema,
  DoormanStatsSchema,
  DESKTOP_APP_ORIGIN,
} from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { harness, type Harness } from './fakes.js'

/**
 * What the doorman counts for its owner's admin page (tally.ts), and who
 * may see it: the owner on a device of their own, never a friend and never a
 * server holding the owner's grant.
 */

const SHA = 'a'.repeat(64)
const SONG = `audio/${SHA}.m4a`
const COVER = `covers/${SHA}.jpg`
const TODAY = '2026-09-11'
const DAY_MS = 24 * 60 * 60 * 1000

async function serverGrant(h: Harness, token: string): Promise<string> {
  const response = await h.call('/v1/grants', {
    method: 'POST',
    token,
    json: { server: 'https://pi.example.ts.net', name: 'pi' },
  })
  expect(response.status).toBe(201)
  return DoormanGrantMadeSchema.parse(await response.json()).token
}

async function stats(h: Harness, token: string, days = 7) {
  const response = await h.call(`${DOORMAN_PATHS.stats}?days=${days}`, { token })
  expect(response.status).toBe(200)
  return DoormanStatsSchema.parse(await response.json()).days
}

async function requests(h: Harness, token: string) {
  const response = await h.call(DOORMAN_PATHS.accessRequests, { token })
  expect(response.status).toBe(200)
  return DoormanAccessRequestsSchema.parse(await response.json()).requests
}

describe('who may see and change the owner’s things', () => {
  it('refuses a server’s grant, even though it is in the owner’s name', async () => {
    const h = harness()
    const owner = await h.signIn()
    const grant = await serverGrant(h, owner)

    expect((await h.call(DOORMAN_PATHS.access, { token: grant })).status).toBe(403)
    const put = await h.call(DOORMAN_PATHS.access, {
      method: 'PUT',
      token: grant,
      json: { anyone: true, emails: [] },
    })
    expect(put.status).toBe(403)
    expect((await h.call(DOORMAN_PATHS.stats, { token: grant })).status).toBe(403)
    expect((await h.call(DOORMAN_PATHS.accessRequests, { token: grant })).status).toBe(403)

    // The owner's own device still may.
    expect((await h.call(DOORMAN_PATHS.access, { token: owner })).status).toBe(200)
  })

  it('refuses a friend', async () => {
    const h = harness()
    const friend = await h.signIn({ sub: '2', email: 'friend@example.com' })
    expect((await h.call(DOORMAN_PATHS.stats, { token: friend })).status).toBe(403)
    expect((await h.call(DOORMAN_PATHS.accessRequests, { token: friend })).status).toBe(403)
  })
})

describe('counting reads', () => {
  it('counts each read by its folder and by the app that made it', async () => {
    const h = harness()
    const owner = await h.signIn()
    expect((await h.connect(owner)).status).toBe(200)
    h.bucket.put(`selfmp3/${SONG}`, 'abc')
    h.bucket.put(`selfmp3/${COVER}`, 'cover')

    const read = (key: string, init: { origin?: string; token?: string } = {}) =>
      h.call(DOORMAN_PATHS.file(key), { token: owner, ...init })
    expect((await read(SONG)).status).toBe(200)
    expect((await read(SONG, { origin: 'https://app.example.com' })).status).toBe(200)
    expect((await read(COVER, { origin: DESKTOP_APP_ORIGIN })).status).toBe(200)
    expect((await read(COVER, { token: await serverGrant(h, owner) })).status).toBe(200)
    // A file the bucket does not have still cost the bucket a read.
    expect((await read(`covers/${'b'.repeat(64)}.jpg`)).status).toBe(404)
    await h.settle()

    expect(h.tally.day(TODAY)).toMatchObject({
      'reads.audio': 2,
      'reads.covers': 3,
      'reads.by.phone': 2,
      'reads.by.web': 1,
      'reads.by.computer': 1,
      'reads.by.server': 1,
      'signins.new': 1,
    })
  })

  it('gives the owner the days asked for, oldest first, and lets a year-old day go', async () => {
    const h = harness()
    const owner = await h.signIn()
    h.tally.values.set('day:2025-01-01', { 'reads.audio': 9 })
    h.tally.values.set('day:2026-09-09', { 'reads.audio': 4 })
    await h.settle()

    const days = await stats(h, owner, 7)
    expect(days.map(d => d.day)).toEqual(['2026-09-09', TODAY])
    expect(days[1]?.counts['signins.new']).toBe(1)
    expect(h.tally.values.has('day:2025-01-01')).toBe(false)
  })
})

describe('people asking to be let in', () => {
  it('remembers an address Google signed in that was not on the list, for the owner', async () => {
    const h = harness()
    const owner = await h.signIn()
    await expect(h.signIn({ sub: '9', email: 'Stranger@Example.org' })).rejects.toThrow(/403/)
    h.clock.now += 60_000
    await expect(h.signIn({ sub: '9', email: 'stranger@example.org' })).rejects.toThrow(/403/)
    await h.settle()

    expect(await requests(h, owner)).toEqual([
      {
        email: 'stranger@example.org',
        tries: 2,
        firstAt: '2026-09-11T12:00:00.000Z',
        lastAt: '2026-09-11T12:01:00.000Z',
      },
    ])
    expect(h.tally.day(TODAY)['signins.refused']).toBe(2)
  })

  it('forgets them once let in, or dismissed, or after a week', async () => {
    const h = harness()
    const owner = await h.signIn()
    for (const [sub, email] of [
      ['7', 'one@example.org'],
      ['8', 'two@example.org'],
      ['9', 'three@example.org'],
    ] as const) {
      await expect(h.signIn({ sub, email })).rejects.toThrow(/403/)
    }
    await h.settle()

    const put = await h.call(DOORMAN_PATHS.access, {
      method: 'PUT',
      token: owner,
      json: { anyone: false, emails: ['friend@example.com', 'one@example.org'] },
    })
    expect(DoormanAccessSchema.parse(await put.json()).emails).toContain('one@example.org')
    const dismissed = await h.call(`${DOORMAN_PATHS.accessRequests}?email=two%40example.org`, {
      method: 'DELETE',
      token: owner,
    })
    expect(dismissed.status).toBe(204)
    expect((await requests(h, owner)).map(r => r.email)).toEqual(['three@example.org'])

    h.clock.now += 8 * DAY_MS
    expect(await requests(h, owner)).toEqual([])
    expect(h.tally.values.has('asked:three@example.org')).toBe(false)
  })
})

import {
  DOORMAN_PATHS,
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

    // The owner's own device still may.
    expect((await h.call(DOORMAN_PATHS.access, { token: owner })).status).toBe(200)
  })

  it('refuses a friend', async () => {
    const h = harness()
    const friend = await h.signIn({ sub: '2', email: 'friend@example.com' })
    expect((await h.call(DOORMAN_PATHS.stats, { token: friend })).status).toBe(403)
  })

  it('takes the admin key the owner’s server holds, and nothing like it', async () => {
    const h = harness()
    const key = 'k'.repeat(64)
    h.env.ADMIN_TOKEN = key
    const read = await h.call(DOORMAN_PATHS.access, { token: key })
    expect(read.status).toBe(200)
    expect(DoormanAccessSchema.parse(await read.json()).emails).toEqual(['friend@example.com'])
    const put = await h.call(DOORMAN_PATHS.access, {
      method: 'PUT',
      token: key,
      json: { anyone: false, emails: ['friend@example.com', 'new@example.com'] },
    })
    expect(put.status).toBe(200)
    expect((await h.call(DOORMAN_PATHS.stats, { token: key })).status).toBe(200)

    expect((await h.call(DOORMAN_PATHS.access, { token: 'k'.repeat(63) })).status).toBe(401)
    // A key too short to be one is no key at all, even typed back exactly.
    h.env.ADMIN_TOKEN = 'short'
    expect((await h.call(DOORMAN_PATHS.access, { token: 'short' })).status).toBe(401)
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

describe('refused sign-ins', () => {
  it('are counted, and the address is not kept', async () => {
    const h = harness()
    await expect(h.signIn({ sub: '9', email: 'stranger@example.org' })).rejects.toThrow(/403/)
    await h.settle()
    expect(h.tally.day(TODAY)['signins.refused']).toBe(1)
    expect(JSON.stringify([...h.tally.values])).not.toContain('stranger')
  })
})

import { DoormanAccessSchema, ErrorBodySchema } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { Access, type AccessCache } from './access.js'
import { FakeKv, harness, type Clock, type Harness } from './fakes.js'

/**
 * Who may sign in, as the doorman's owner keeps it from Settings: the owners
 * are always in, everyone else is on the list or not.
 */

async function read(h: Harness, token: string) {
  const response = await h.call('/v1/access', { token })
  expect(response.status).toBe(200)
  return DoormanAccessSchema.parse(await response.json())
}

function put(h: Harness, token: string, json: unknown) {
  return h.call('/v1/access', { method: 'PUT', token, json })
}

describe('the allow list', () => {
  it('shows the owner who may sign in, and nobody else', async () => {
    const h = harness()
    const owner = await h.signIn()
    expect(await read(h, owner)).toEqual({
      anyone: false,
      emails: ['friend@example.com'],
      owners: ['me@example.com'],
    })

    const friend = await h.signIn({ sub: '2', email: 'friend@example.com' })
    const refused = await h.call('/v1/access', { token: friend })
    expect(refused.status).toBe(403)
    expect((await put(h, friend, { anyone: true, emails: [] })).status).toBe(403)
  })

  it('lets the owner add and remove people, which holds at once', async () => {
    const h = harness()
    const owner = await h.signIn()
    const friend = await h.signIn({ sub: '2', email: 'friend@example.com' })

    const writes = h.kv.writes
    const saved = await put(h, owner, { anyone: false, emails: [' New@Example.com '] })
    expect(saved.status).toBe(200)
    expect(h.kv.writes).toBe(writes + 1)
    expect(DoormanAccessSchema.parse(await saved.json()).emails).toEqual(['new@example.com'])

    // Off the list: the friend's session is refused, on this very instance.
    expect((await h.call('/v1/me', { token: friend })).status).toBe(401)
    const newcomer = await h.signIn({ sub: '3', email: 'new@example.com' })
    expect((await h.call('/v1/me', { token: newcomer })).status).toBe(200)

    await put(h, owner, { anyone: true, emails: [] })
    expect((await h.call('/v1/me', { token: friend })).status).toBe(200)
  })

  it('never locks the owner out, and keeps no owner on the list', async () => {
    const h = harness()
    const owner = await h.signIn()
    const saved = await put(h, owner, { anyone: false, emails: ['me@example.com'] })
    expect(DoormanAccessSchema.parse(await saved.json()).emails).toEqual([])
    expect((await h.call('/v1/me', { token: owner })).status).toBe(200)
  })

  it('takes addresses only', async () => {
    const h = harness()
    const owner = await h.signIn()
    const response = await put(h, owner, { anyone: false, emails: ['not an address'] })
    expect(response.status).toBe(400)
    expect(ErrorBodySchema.parse(await response.json()).error).toMatch(/email/)
  })

  it('lets someone just added in on an instance that remembered the list from before', async () => {
    const clock: Clock = { now: Date.parse('2026-10-27T12:00:00Z') }
    const kv = new FakeKv(clock)
    const instance = () =>
      new Access(kv, 'me@example.com', () => clock.now, new Map() as AccessCache)
    const here = instance()
    const there = instance()
    await here.write({ anyone: false, emails: ['old@example.com'] })

    // The other instance has the list in hand, without the newcomer.
    expect(await there.allows('old@example.com')).toBe(true)
    await here.write({ anyone: false, emails: ['new@example.com'] })
    const reads = kv.reads
    expect(await there.allows('New@Example.com')).toBe(true)
    expect(kv.reads).toBe(reads + 1)

    // A yes is taken from its copy, so a removal takes up to the minute.
    expect(await there.allows('new@example.com')).toBe(true)
    await here.write({ anyone: false, emails: [] })
    expect(await there.allows('new@example.com')).toBe(true)
    clock.now += 60_001
    expect(await there.allows('new@example.com')).toBe(false)
  })

  it('does not say nobody may sign in once the first person is added elsewhere', async () => {
    const clock: Clock = { now: Date.parse('2026-10-27T12:00:00Z') }
    const kv = new FakeKv(clock)
    const instance = () => new Access(kv, undefined, () => clock.now, new Map() as AccessCache)
    const here = instance()
    const there = instance()
    expect(await there.nobody()).toBe(true)
    await here.write({ anyone: false, emails: ['first@example.com'] })
    expect(await there.nobody()).toBe(false)
    expect(await there.allows('first@example.com')).toBe(true)
  })
})

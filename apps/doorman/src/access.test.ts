import { DoormanAccessSchema, ErrorBodySchema } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { harness, type Harness } from './fakes.js'

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
      // Google's name and picture, noted as the owner's session was used.
      profiles: {
        'me@example.com': { name: 'Xiao', picture: 'https://lh3.googleusercontent.com/a/me' },
      },
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
})

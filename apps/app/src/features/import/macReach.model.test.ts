import { describe, expect, it } from 'vitest'
import type { ServerConnection } from '@selfmp3/client'
import { awayCopy, candidates, reachMac } from './macReach.model'

const server = {
  addresses: ['http://localhost:4600', 'http://192.168.1.20:4600', 'http://100.101.1.2:4600'],
  token: 'secret-token',
}

describe('candidates', () => {
  it('turns each address into a connection carrying the token', () => {
    expect(candidates(server)).toEqual([
      { baseUrl: 'http://localhost:4600', token: 'secret-token' },
      { baseUrl: 'http://192.168.1.20:4600', token: 'secret-token' },
      { baseUrl: 'http://100.101.1.2:4600', token: 'secret-token' },
    ])
    expect(candidates(null)).toEqual([])
  })
})

describe('reachMac', () => {
  const answers = (by: Record<string, Promise<boolean>>) => (connection: ServerConnection) =>
    by[connection.baseUrl] ?? Promise.resolve(false)

  it('takes the first address that answers, without waiting on the ones that hang', async () => {
    let hangUp: (ok: boolean) => void = () => undefined
    const hanging = new Promise<boolean>(resolve => {
      hangUp = resolve
    })
    const found = await reachMac(
      candidates(server),
      answers({
        'http://localhost:4600': hanging,
        'http://192.168.1.20:4600': Promise.resolve(true),
      }),
    )
    expect(found?.baseUrl).toBe('http://192.168.1.20:4600')
    hangUp(false)
  })

  it('is null when no address answers, a refusal and a failure alike', async () => {
    const found = await reachMac(
      candidates(server),
      answers({
        'http://localhost:4600': Promise.reject(new Error('connection refused')),
        'http://192.168.1.20:4600': Promise.resolve(false),
      }),
    )
    expect(found).toBeNull()
  })

  it('is null at once with no addresses to try', async () => {
    let asked = 0
    const found = await reachMac([], () => {
      asked++
      return Promise.resolve(true)
    })
    expect(found).toBeNull()
    expect(asked).toBe(0)
  })
})

describe('awayCopy', () => {
  it('tells a Mac that is off apart from one that never said where it is', () => {
    expect(awayCopy(true).title).toBe('Your Mac isn’t answering')
    expect(awayCopy(false).title).toBe('Your Mac hasn’t said where it is')
    expect(awayCopy(false).body).toContain('sync once')
  })
})

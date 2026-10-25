import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchPublic, isPublicAddress } from './publicWeb.js'

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.101.102.103',
    '0.0.0.0',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'fd7a:115c:a1e0::1',
    'fe80::1',
    'not an address',
  ])('refuses %s', address => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it.each(['93.184.215.14', '1.1.1.1', '2606:4700:4700::1111'])('lets %s through', address => {
    expect(isPublicAddress(address)).toBe(true)
  })
})

describe('fetchPublic', () => {
  let server: http.Server
  let port = 0
  const signal = (): AbortSignal => AbortSignal.timeout(5_000)
  const limit = 1024
  const onlyIpv4Loopback = (address: string): boolean => address === '127.0.0.1'

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const to = new URL(request.url ?? '/', 'http://x').searchParams.get('to')
      if (to) {
        response.writeHead(302, { location: to }).end()
      } else if (request.url === '/big') {
        response.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.alloc(limit + 1))
      } else {
        response.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.alloc(16, 7))
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(() => {
    server.close()
  })

  it.each([
    () => `http://127.0.0.1:${port}/art.png`,
    () => `http://[::ffff:127.0.0.1]:${port}/art.png`,
    // A name is judged by what it resolves to, as the connection is made.
    () => `http://localhost:${port}/art.png`,
  ])('will not reach this machine (%#)', async url => {
    await expect(fetchPublic(url(), { signal: signal(), limit })).rejects.toThrow(/open web/)
  })

  it('reads an allowed address', async () => {
    const file = await fetchPublic(
      `http://127.0.0.1:${port}/art.png`,
      { signal: signal(), limit },
      onlyIpv4Loopback,
    )
    expect(file).toEqual({ contentType: 'image/png', data: Buffer.alloc(16, 7) })
  })

  it('stops reading past the limit', async () => {
    const file = await fetchPublic(
      `http://127.0.0.1:${port}/big`,
      { signal: signal(), limit },
      onlyIpv4Loopback,
    )
    expect(file?.data).toBeNull()
  })

  it.each([
    () => `http://169.254.169.254/latest/meta-data/`,
    () => `http://[::1]:${port}/art.png`,
    () => 'file:///etc/passwd',
  ])('checks where a redirect leads (%#)', async to => {
    const from = `http://127.0.0.1:${port}/?to=${encodeURIComponent(to())}`
    await expect(fetchPublic(from, { signal: signal(), limit }, onlyIpv4Loopback)).rejects.toThrow(
      /open web/,
    )
  })

  it('follows a redirect that stays allowed', async () => {
    const to = `http://127.0.0.1:${port}/art.png`
    const file = await fetchPublic(
      `http://127.0.0.1:${port}/?to=${encodeURIComponent(to)}`,
      { signal: signal(), limit },
      onlyIpv4Loopback,
    )
    expect(file?.data?.length).toBe(16)
  })
})

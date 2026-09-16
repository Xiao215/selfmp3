import { describe, expect, it } from 'vitest'
import { isLocalRequest } from './local.js'

/**
 * Who counts as being at the keyboard.
 *
 * Two things ride on this answer: whether "Show in Finder" opens a window on
 * the server, and whether a request is asked for the bearer token at all. The
 * second makes every false positive here an authentication bypass, so the
 * interesting cases are all the ways something remote can look local.
 *
 * `auth.test.ts` asks the same question over a real socket, which is the only
 * way to prove express agrees; this covers the shapes a socket is awkward to
 * produce.
 */

const request = (
  remoteAddress: string | undefined,
  host: string,
  headers: Record<string, string> = {},
) =>
  ({ socket: { remoteAddress }, headers: { host, ...headers } }) as unknown as Parameters<
    typeof isLocalRequest
  >[0]

describe('isLocalRequest', () => {
  it('accepts the browser on the same machine', () => {
    expect(isLocalRequest(request('127.0.0.1', 'localhost:4600'))).toBe(true)
    expect(isLocalRequest(request('::1', '[::1]:4600'))).toBe(true)
    expect(isLocalRequest(request('::ffff:127.0.0.1', '127.0.0.1:4601'))).toBe(true)
  })

  it('refuses a phone on the network', () => {
    expect(isLocalRequest(request('100.101.102.103', 'mac.tail1234.ts.net'))).toBe(false)
    expect(isLocalRequest(request('192.168.1.20', '192.168.1.10:4600'))).toBe(false)
  })

  it('refuses a request proxied from loopback on behalf of a remote name', () => {
    // `tailscale serve` and the dev proxy both connect from 127.0.0.1.
    expect(isLocalRequest(request('127.0.0.1', 'mac.tail1234.ts.net'))).toBe(false)
    expect(isLocalRequest(request('127.0.0.1', '192.168.1.10:4601'))).toBe(false)
  })

  /*
   * `trust proxy` is set, so express would read `req.ip` out of these. Nothing
   * here does, and a request carrying one is refused outright: whatever added
   * it stood between the sender and here, so the sender was not here.
   */
  it('refuses a request that was forwarded, however local it claims to be', () => {
    expect(
      isLocalRequest(request('127.0.0.1', 'localhost:4600', { 'x-forwarded-for': '127.0.0.1' })),
    ).toBe(false)
    expect(
      isLocalRequest(request('127.0.0.1', 'localhost:4600', { forwarded: 'for=127.0.0.1' })),
    ).toBe(false)
    expect(
      isLocalRequest(request('192.168.1.20', 'localhost:4600', { 'x-forwarded-for': '127.0.0.1' })),
    ).toBe(false)
  })

  it('refuses a connection with no peer address at all', () => {
    expect(isLocalRequest(request(undefined, 'localhost:4600'))).toBe(false)
  })

  it('is not fooled by a host that merely starts with a loopback name', () => {
    expect(isLocalRequest(request('127.0.0.1', 'localhost.evil.example:4600'))).toBe(false)
    expect(isLocalRequest(request('127.0.0.1', '127.0.0.1.evil.example'))).toBe(false)
  })
})

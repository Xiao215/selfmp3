import type { NextFunction, Request, Response } from 'express'
import { EXTENSION_ORIGIN } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import type { Config } from '../config.js'
import { HttpError } from './errors.js'
import { APP_SITE_ORIGIN, sameOriginWrites } from './middleware.js'

/**
 * The guard that keeps another website from writing to your library.
 *
 * Nothing here needs a cookie, so the usual reasoning about credentials does
 * not apply — what makes the server reachable is that it answers at a
 * predictable address with no token. `Origin` is what tells the real app apart
 * from a page that merely knows the address.
 */

const config = (corsOrigins: string[], publicUrl: string | null = null): Config =>
  ({ corsOrigins, publicUrl }) as unknown as Config

function run(
  method: string,
  headers: Record<string, string>,
  corsOrigins: string[] = [],
  publicUrl: string | null = null,
): HttpError | null {
  const req = { method, headers, protocol: 'http' } as unknown as Request
  let passed: unknown
  const next = ((error?: unknown) => {
    passed = error
  }) as NextFunction
  sameOriginWrites(config(corsOrigins, publicUrl))(req, {} as Response, next)
  return passed instanceof HttpError ? passed : null
}

describe('sameOriginWrites', () => {
  it('refuses a write sent from a site we do not know', () => {
    const error = run('POST', { origin: 'https://evil.example', host: '127.0.0.1:4600' })
    expect(error?.status).toBe(403)
  })

  it('refuses every method that can change something', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const error = run(method, { origin: 'https://evil.example', host: '127.0.0.1:4600' })
      expect(error?.status, method).toBe(403)
    }
  })

  it('lets a read through whatever asked for it', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(run(method, { origin: 'https://evil.example', host: '127.0.0.1:4600' })).toBeNull()
    }
  })

  it('lets through the app this very server is serving', () => {
    expect(run('POST', { origin: 'http://127.0.0.1:4600', host: '127.0.0.1:4600' })).toBeNull()
  })

  it('lets through the desktop app, whose origin no website can claim', () => {
    expect(run('POST', { origin: 'app://selfmp3', host: '192.168.1.20:4600' })).toBeNull()
  })

  it('lets through the browser extension, whose id its committed key fixes', () => {
    expect(run('POST', { origin: EXTENSION_ORIGIN, host: '100.101.1.2:4600' })).toBeNull()
  })

  it('refuses any other extension', () => {
    const error = run('POST', {
      origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
      host: '127.0.0.1:4600',
    })
    expect(error?.status).toBe(403)
  })

  it('lets through an origin the config allows', () => {
    const allowed = ['https://xiao215.github.io']
    expect(
      run('POST', { origin: 'https://xiao215.github.io', host: 'mac:4600' }, allowed),
    ).toBeNull()
  })

  /*
   * The phone, `curl` and a shortcut send no `Origin` at all. There is no
   * browser there to be tricked into sending one, so there is nothing to guard
   * against — refusing these would only break every non-browser client.
   */
  it('leaves a request with no Origin alone', () => {
    expect(run('POST', { host: '127.0.0.1:4600' })).toBeNull()
  })

  it('refuses the opaque origin a sandboxed frame sends', () => {
    // Any page can put a sandboxed frame on you, and it arrives as "null".
    const error = run('POST', { origin: 'null', host: '127.0.0.1:4600' })
    expect(error?.status).toBe(403)
  })

  it('does not mistake a lookalike host for our own', () => {
    const error = run('POST', {
      origin: 'http://127.0.0.1:4600.evil.example',
      host: '127.0.0.1:4600',
    })
    expect(error?.status).toBe(403)
  })
  /*
   * A public address exists so that a device away from the house can reach this
   * server, and the app on such a device is the published site. Publishing the
   * address and then refusing the only page that would call it is no setting at
   * all, so the two go together — and neither one waves the token through.
   */
  it('lets the published site through once a public address is set', () => {
    expect(
      run(
        'POST',
        { origin: APP_SITE_ORIGIN, host: 'music.example.com' },
        [],
        'https://music.example.com',
      ),
    ).toBeNull()
  })

  it('does not let it through on a server with no public address', () => {
    const error = run('POST', { origin: APP_SITE_ORIGIN, host: '127.0.0.1:4600' })
    expect(error?.status).toBe(403)
  })

  it('still refuses another site when a public address is set', () => {
    const error = run(
      'POST',
      { origin: 'https://evil.example', host: 'music.example.com' },
      [],
      'https://music.example.com',
    )
    expect(error?.status).toBe(403)
  })
})

import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it } from 'vitest'
import type { Config } from '../config.js'
import { HttpError } from './errors.js'
import { sameOriginWrites } from './middleware.js'

/**
 * The guard that keeps another website from writing to your library.
 *
 * Nothing here needs a cookie, so the usual reasoning about credentials does
 * not apply — what makes the server reachable is that it answers at a
 * predictable address with no token. `Origin` is what tells the real app apart
 * from a page that merely knows the address.
 */

const config = (corsOrigins: string[]): Config => ({ corsOrigins }) as unknown as Config

function run(
  method: string,
  headers: Record<string, string>,
  corsOrigins: string[] = [],
): HttpError | null {
  const req = { method, headers, protocol: 'http' } as unknown as Request
  let passed: unknown
  const next = ((error?: unknown) => {
    passed = error
  }) as NextFunction
  sameOriginWrites(config(corsOrigins))(req, {} as Response, next)
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
})

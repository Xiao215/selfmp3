import { describe, expect, it } from 'vitest'
import { isLocalRequest, revealCommand } from './reveal.js'

const request = (remoteAddress: string, host: string) =>
  ({ socket: { remoteAddress }, headers: { host } }) as unknown as Parameters<
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
})

describe('revealCommand', () => {
  const file = '/Users/me/music/library/YOASOBI - 夜に駆ける.m4a'

  it('selects the file in Finder on a Mac', () => {
    expect(revealCommand(file, 'darwin')).toEqual({ command: 'open', args: ['-R', file] })
  })

  it('selects it in Explorer on Windows', () => {
    expect(revealCommand(file, 'win32')?.args).toEqual([`/select,${file}`])
  })

  it('opens the folder on Linux, and has nothing for other platforms', () => {
    expect(revealCommand(file, 'linux')?.args).toEqual(['/Users/me/music/library'])
    expect(revealCommand(file, 'aix')).toBeNull()
  })
})

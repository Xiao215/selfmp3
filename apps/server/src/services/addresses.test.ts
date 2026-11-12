import { describe, expect, it } from 'vitest'
import {
  beyondThisComputer,
  isTranslatorAddress,
  listenAddresses,
  publishedAddresses,
} from './addresses.js'

/**
 * Which of a server's addresses are somebody else's way in.
 *
 * The boot log warns on exactly this list when no token is set, so a wrong
 * answer is either a warning nobody needed or — worse — silence about a library
 * that is open to the room.
 */

describe('beyondThisComputer', () => {
  it('keeps nothing when the server answers only itself', () => {
    expect(beyondThisComputer(listenAddresses('127.0.0.1', 4600))).toEqual([])
  })

  it.each([
    'http://localhost:4600',
    'http://127.0.0.1:4600',
    'http://127.1.2.3:4600',
    'http://[::1]:4600',
  ])('does not count %s', url => {
    expect(beyondThisComputer([{ url }])).toEqual([])
  })

  it.each([
    'http://10.0.0.228:4600',
    'http://192.168.1.4:4600',
    'http://100.87.3.9:4600',
    // A name that merely starts like the loopback one is still somebody else.
    'http://localhost.example.com:4600',
  ])('counts %s', url => {
    expect(beyondThisComputer([{ url }])).toEqual([url])
  })

  it('separates the two when the server answers on everything', () => {
    const open = beyondThisComputer([
      { url: 'http://localhost:4600' },
      { url: 'http://10.0.0.228:4600' },
      { url: 'http://100.87.3.9:4600' },
    ])
    expect(open).toEqual(['http://10.0.0.228:4600', 'http://100.87.3.9:4600'])
  })
})

/**
 * And which of them a device somewhere else is given.
 *
 * Everything this computer can see about itself is a local `http://` address,
 * which is no use to a phone on mobile data and is refused outright by the
 * published app, served over HTTPS. The public address is the only line out,
 * so a snapshot published without it strands every device that is not at home.
 */
describe('publishedAddresses', () => {
  it('names only the public address when there is one', () => {
    // The Wi-Fi and Tailscale addresses are where the server was, not where it
    // is: carried to another network, it leaves them in every device's list.
    const published = publishedAddresses('0.0.0.0', 4600, 'https://music.example.com')
    expect(published.map(address => address.url)).toEqual(['https://music.example.com'])
  })

  it('names the addresses found here when there is no public one', () => {
    expect(publishedAddresses('127.0.0.1', 4600, null)).toEqual(listenAddresses('127.0.0.1', 4600))
  })

  it("counts as somebody else's way in, token and all", () => {
    const published = publishedAddresses('127.0.0.1', 4600, 'https://music.example.com')
    expect(beyondThisComputer(published)).toEqual(['https://music.example.com'])
  })
})

/**
 * The one IPv4 address a computer on an IPv6-only network gives itself is not
 * a way in for anyone: the phone in the same room holds the same one.
 */
describe('isTranslatorAddress', () => {
  it.each(['192.0.0.1', '192.0.0.2', '192.0.0.7'])('leaves %s out', ip => {
    expect(isTranslatorAddress(ip)).toBe(true)
  })

  it.each(['192.0.0.8', '192.0.1.2', '192.168.0.2', '10.0.0.2', '100.64.0.2'])(
    'keeps %s, which somebody else can reach',
    ip => {
      expect(isTranslatorAddress(ip)).toBe(false)
    },
  )
})

import { describe, expect, it } from 'vitest'
import { beyondThisComputer, listenAddresses } from './addresses.js'

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

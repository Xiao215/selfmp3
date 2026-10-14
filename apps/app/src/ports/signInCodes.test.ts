import { describe, expect, it } from 'vitest'

import { createSignInInbox, signInLink } from './signInCodes'

/**
 * Sign-in links coming back. Worth tests rather than a glance: a code lost
 * before its screen listened, or handed over twice, is a sign-in that worked
 * and reads as one that failed — and nobody can type their way out of it any more.
 */
describe('signInLink', () => {
  it('reads the target and the code from an installed app’s link', () => {
    expect(signInLink('selfmp3://welcome#signin-code=4F7K2QXM')).toEqual({
      target: 'welcome',
      code: '4F7K2QXM',
    })
    expect(signInLink('selfmp3://welcome#signin-code=4F7K-2QXM')?.code).toBe('4F7K2QXM')
  })

  it('reads a browser’s return the same way, wherever the site lives', () => {
    expect(signInLink('https://example.github.io/selfmp3/welcome#signin-code=4F7K2QXM')).toEqual({
      target: 'welcome',
      code: '4F7K2QXM',
    })
    expect(signInLink('selfmp3://welcome/#signin-code=4F7K2QXM')?.target).toBe('welcome')
  })

  it('is null for anything that is not a sign-in coming back', () => {
    expect(signInLink('selfmp3://welcome')).toBeNull()
    // Settings has no sign-in of its own: a server signs in on its own page.
    expect(signInLink('selfmp3://settings#signin-code=4F7K2QXM')).toBeNull()
    expect(signInLink('selfmp3://now-playing#signin-code=4F7K2QXM')).toBeNull()
    expect(signInLink('selfmp3://welcome#signin-code=nope')).toBeNull()
    expect(signInLink('https://example.com#signin-code=4F7K2QXM')).toBeNull()
  })
})

describe('createSignInInbox', () => {
  it('keeps a link that arrived before anyone listened', () => {
    const inbox = createSignInInbox()
    expect(inbox.arrive('selfmp3://welcome#signin-code=4F7K2QXM')).toBe(true)

    const firstRun: string[] = []
    inbox.listen('welcome', code => firstRun.push(code))
    expect(firstRun).toEqual(['4F7K2QXM'])
  })

  it('hands a code to whoever is listening as it arrives', () => {
    const inbox = createSignInInbox()
    const seen: string[] = []
    inbox.listen('welcome', code => seen.push(code))
    inbox.arrive('selfmp3://welcome#signin-code=4F7K2QXM')
    expect(seen).toEqual(['4F7K2QXM'])
  })

  it('hands each code over once, even when its link arrives twice', () => {
    const inbox = createSignInInbox()
    const seen: string[] = []
    inbox.listen('welcome', code => seen.push(code))
    inbox.arrive('selfmp3://welcome#signin-code=4F7K2QXM')
    inbox.arrive('selfmp3://welcome#signin-code=4F7K2QXM')
    expect(seen).toEqual(['4F7K2QXM'])
  })

  it('keeps a code for later once its screen has stopped listening', () => {
    const inbox = createSignInInbox()
    const stop = inbox.listen('welcome', () => {
      throw new Error('should not hear this')
    })
    stop()
    inbox.arrive('selfmp3://welcome#signin-code=4F7K2QXM')

    const later: string[] = []
    inbox.listen('welcome', code => later.push(code))
    expect(later).toEqual(['4F7K2QXM'])
  })

  it('leaves other links alone', () => {
    expect(createSignInInbox().arrive('selfmp3://now-playing')).toBe(false)
  })
})

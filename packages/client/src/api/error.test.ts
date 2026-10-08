import { describe, expect, it } from 'vitest'
import { ApiError, failureText } from './error.js'

describe('failureText', () => {
  it('says an unreachable library as that, not as the network error', () => {
    expect(failureText('Couldn’t save “Run”', new ApiError(0, 'Failed to fetch', 'offline'))).toBe(
      'Couldn’t save “Run”, your library isn’t reachable right now',
    )
  })

  it('says a used-up allowance as that', () => {
    const capped = new ApiError(503, 'cap exceeded: download', 'bucket_cap_exceeded')
    expect(failureText('Couldn’t play it', capped)).toBe(
      'Couldn’t play it, your storage’s allowance for today is used up',
    )
  })

  it('keeps a refusal the server worded for people', () => {
    const clash = new ApiError(409, 'a tag called "chill" already exists', 'conflict')
    expect(failureText('Couldn’t make the tag', clash)).toBe(
      'Couldn’t make the tag: a tag called "chill" already exists',
    )
  })

  it('stops at the failure for a server error, a bad shape or a thrown exception', () => {
    const failures = [
      new ApiError(500, 'POST /api/playlists failed (500)'),
      new ApiError(500, 'Unexpected answer from /api/library: Required', 'contract_mismatch'),
      new ApiError(404, 'GET /api/nope failed (404)'),
      new ApiError(400, 'name: Required', 'bad_request'),
      new Error('undefined is not a function'),
    ]
    for (const failure of failures) {
      expect(failureText('Couldn’t make the playlist', failure)).toBe('Couldn’t make the playlist')
    }
  })
})

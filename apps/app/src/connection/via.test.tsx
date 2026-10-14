import { ApiError, failureText } from '@selfmp3/client'
import { API_ERROR } from '@selfmp3/shared'
import { noServer, noServerToAsk } from './via'

describe('no server to ask', () => {
  it('is an offline failure, worded like a server that did not answer', () => {
    const failure = noServerToAsk()
    expect(failure).toBeInstanceOf(ApiError)
    expect(failure.status).toBe(0)
    expect(failure.code).toBe(API_ERROR.offline)
    expect(failureText('Couldn’t ask', failure)).toBe(
      'Couldn’t ask, your library isn’t reachable right now',
    )
  })

  it('is what a via-server query with no server fails with', async () => {
    await expect(noServer()).rejects.toMatchObject({ status: 0, code: API_ERROR.offline })
  })
})

import { render, screen } from '@testing-library/react-native'

import { PendingImports } from './PendingImports'

jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useCloudImports: () => ({
    data: {
      imports: [
        {
          uid: 'a',
          url: 'https://www.youtube.com/watch?v=dGZqpVCJP3k',
          state: 'working',
          title: '群青',
          songIds: [],
          error: null,
          requestedAt: '2026-09-13T10:00:00.000Z',
          requestedBy: 'iphone-1',
        },
        {
          uid: 'b',
          url: 'https://youtu.be/ZRtdQ81jPUQ',
          state: 'done',
          title: 'アイドル',
          songIds: [3],
          error: null,
          requestedAt: '2026-09-13T09:00:00.000Z',
          requestedBy: 'iphone-1',
        },
      ],
    },
  }),
  useLibrary: () => ({ data: { songs: [{ id: 3 }] } }),
}))

/**
 * Songs on their way into a cloud library: the rows drawn from this device's
 * requests, until the server has published what they bring.
 */
describe('PendingImports', () => {
  it('draws a row for a request still on its way, with where it is', async () => {
    await render(<PendingImports />)
    expect(screen.getByText('群青')).toBeTruthy()
    expect(screen.getByText('Downloading on your server…')).toBeTruthy()
  })

  it('leaves out a request whose songs are already in the library', async () => {
    await render(<PendingImports />)
    expect(screen.queryByText('アイドル')).toBeNull()
  })
})

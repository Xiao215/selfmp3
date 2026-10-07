import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { configureClient, type Api } from '@selfmp3/client'
import type { Song, Tag } from '@selfmp3/shared'

import { TagPicker, TagSearchList } from './TagPicker'

/**
 * The picker pointed at another library (a cloud library's import, talking
 * to the server directly). A tag made on this device reaches the server only
 * when it next reads the logs, so for a while the server's list lacks it —
 * and the import's "Tag it" could not find a tag the sidebar showed
 * (Xiao, 2026-10-05).
 */

const tag = (id: number, name: string): Tag =>
  ({ id, name, hue: 0, songCount: 1 }) as unknown as Tag

let mockHere: Tag[] = []
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => ({ data: { songs: [], playlists: [], tags: mockHere } }),
  useCreateTag: () => ({ mutateAsync: jest.fn() }),
}))
jest.mock('./Popover', () => ({
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
}))
jest.mock('../../features/tag/useArtistNudge', () => ({
  useArtistNudge: () => ({ check: (_: string, go: () => void) => go(), nudge: null }),
}))
jest.mock('../../shell/useLayout', () => {
  const layout = { wide: false, dense: false, compact: true, finePointer: false, width: 390 }
  return {
    useLayout: () => layout,
    useLayoutValue: (select: (value: typeof layout) => unknown) => select(layout),
    useWindowValue: (select: (value: object) => unknown) =>
      select({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  }
})

describe('TagSearchList from another library', () => {
  it('offers a tag only this device has yet, and makes it there when ticked', async () => {
    mockHere = [tag(1, 'chill'), tag(2, '毕业季')]
    const there = [tag(40, 'Chill')]
    const create = jest.fn((name: string) => Promise.resolve(tag(41, name)))
    const onChange = jest.fn()
    await render(
      <TagSearchList selected={new Set()} onChange={onChange} from={{ tags: there, create }} />,
    )
    // One chill, the server's: the same name in another case is the same tag.
    expect(screen.getAllByRole('checkbox', { name: /chill/i })).toHaveLength(1)

    await fireEvent.press(screen.getByRole('checkbox', { name: '毕业季' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith('毕业季'))
    // The server's id is the one ticked, never this device's.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(new Set([41])))
  })

  it('ticks a tag the server has without making anything', async () => {
    mockHere = [tag(1, 'chill')]
    const create = jest.fn()
    const onChange = jest.fn()
    await render(
      <TagSearchList
        selected={new Set()}
        onChange={onChange}
        from={{ tags: [tag(40, 'chill')], create }}
      />,
    )
    await fireEvent.press(screen.getByRole('checkbox', { name: 'chill' }))
    expect(onChange).toHaveBeenCalledWith(new Set([40]))
    expect(create).not.toHaveBeenCalled()
  })
})

describe('TagPicker on a song', () => {
  /** A server whose answers are held until the test lets each one go. */
  function heldServer() {
    const calls: { tagIds: number[]; answer: () => void; refuse: () => void }[] = []
    configureClient({
      api: {
        setSongTags: (id: number, tagIds: number[]) =>
          new Promise((resolve, reject) => {
            calls.push({
              tagIds,
              answer: () => resolve({ id, tagIds } as Song),
              refuse: () => reject(new Error('timed out')),
            })
          }),
        onCloudLibraryChanged: () => () => undefined,
        answersFromCloud: () => false,
      } as unknown as Api,
    })
    return calls
  }

  /*
   * Ticking jpop on, then off before the first answer came back: the first
   * landed, the second failed. The song has jpop, so the box is ticked —
   * it was left empty, while the song's own chips showed jpop (Xiao,
   * 2026-10-07).
   */
  it('shows what the song has after quick ticks when the last one fails', async () => {
    mockHere = [tag(1, 'jpop')]
    const calls = heldServer()
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const song = { id: 7, title: '曲终奏雅', tagIds: [] } as unknown as Song
    await render(
      <QueryClientProvider client={client}>
        <TagPicker song={song} onClose={() => undefined} />
      </QueryClientProvider>,
    )
    const jpop = () => screen.getByRole('checkbox', { name: 'jpop' })

    await fireEvent.press(jpop())
    await fireEvent.press(jpop())
    expect(jpop().props['accessibilityState'].checked).toBe(false)

    // The requests for one song go one at a time: the second waits for the first.
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0]?.answer())
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls.map(call => call.tagIds)).toEqual([[1], []])
    await act(async () => calls[1]?.refuse())

    await waitFor(() => expect(jpop().props['accessibilityState'].checked).toBe(true))
  })

  it('leaves a failed tick alone when a later one has been made', async () => {
    mockHere = [tag(1, 'jpop')]
    const calls = heldServer()
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const song = { id: 7, title: '曲终奏雅', tagIds: [] } as unknown as Song
    await render(
      <QueryClientProvider client={client}>
        <TagPicker song={song} onClose={() => undefined} />
      </QueryClientProvider>,
    )
    const jpop = () => screen.getByRole('checkbox', { name: 'jpop' })

    await fireEvent.press(jpop())
    await fireEvent.press(jpop())
    await fireEvent.press(jpop())
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0]?.refuse())
    // The second is under way; the box is still the newest tick's.
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(jpop().props['accessibilityState'].checked).toBe(true)
    await act(async () => calls[1]?.answer())
    await waitFor(() => expect(calls).toHaveLength(3))
    await act(async () => calls[2]?.answer())
    expect(jpop().props['accessibilityState'].checked).toBe(true)
  })
})

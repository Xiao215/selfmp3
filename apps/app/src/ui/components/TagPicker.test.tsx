import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import type { Tag } from '@selfmp3/shared'

import { TagSearchList } from './TagPicker'

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
jest.mock('../../features/tag/useArtistNudge', () => ({
  useArtistNudge: () => ({ check: (_: string, go: () => void) => go(), nudge: null }),
}))
jest.mock('../../shell/useLayout', () => ({
  useLayout: () => ({ wide: false, dense: false, compact: true, finePointer: false, width: 390 }),
}))

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

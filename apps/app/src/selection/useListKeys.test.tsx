/**
 * @jest-environment jsdom
 */
// jsdom rather than the React Native environment: the keys are the web's, on
// `window`, and the rows are found in the document by their attributes — the
// ones React Native for web writes from a `SongRow`'s `dataSet`.
import { renderHook } from '@testing-library/react-native'

import { useHotkeys } from '../shell/useHotkeys.web'
import { closeLayer, openLayer } from '../shell/layers'
import { setTabbing, tabbing } from '../shell/tabbing'
import { useListKeys } from './useListKeys.web'

jest.mock('expo-router', () => ({
  // The page is in front for as long as the hook is mounted.
  useFocusEffect: (effect: () => undefined | (() => void)) => {
    const { useEffect: mockUseEffect } = jest.requireActual<typeof import('react')>('react')
    mockUseEffect(effect, [effect])
  },
}))

/** A list's rows as the browser has them: the row, and its press target inside. */
function drawRows(listKey: string, songIds: readonly number[]): HTMLElement[] {
  const table = document.createElement('div')
  table.setAttribute('role', 'table')
  const targets = songIds.map(songId => {
    const row = document.createElement('div')
    row.setAttribute('role', 'row')
    row.setAttribute('data-song-row', listKey)
    row.setAttribute('data-song-id', String(songId))
    const press = document.createElement('div')
    press.setAttribute('role', 'button')
    press.setAttribute('tabindex', '0')
    press.setAttribute('data-row-press', 'true')
    const more = document.createElement('div')
    more.setAttribute('role', 'button')
    more.setAttribute('tabindex', '0')
    row.append(press, more)
    table.append(row)
    return press
  })
  document.body.append(table)
  return targets
}

function press(
  target: EventTarget,
  key: string,
  init: KeyboardEventInit = {},
): { prevented: boolean } {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return { prevented: event.defaultPrevented }
}

describe('a song list’s keys', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    setTabbing(false)
  })

  async function list(songIds: readonly number[] = [11, 12, 13]): Promise<{
    toggle: jest.Mock
    selectAll: jest.Mock
    rows: HTMLElement[]
    unmount: () => Promise<void>
  }> {
    const toggle = jest.fn()
    const selectAll = jest.fn(() => songIds.length > 0)
    let listKey = ''
    const { unmount } = await renderHook(() => {
      listKey = useListKeys({ toggle, selectAll })
    })
    const rows = drawRows(listKey, songIds)
    return { toggle, selectAll, rows, unmount }
  }

  it('moves between rows with the arrows, and shows the ring as it does', async () => {
    const { rows, unmount } = await list()
    // A click left focus on the first row: no ring yet.
    rows[0]!.focus()
    expect(tabbing()).toBe(false)

    expect(press(rows[0]!, 'ArrowDown').prevented).toBe(true)
    expect(document.activeElement).toBe(rows[1])
    expect(tabbing()).toBe(true)

    press(rows[1]!, 'ArrowDown')
    expect(document.activeElement).toBe(rows[2])
    // The last row stays the last.
    press(rows[2]!, 'ArrowDown')
    expect(document.activeElement).toBe(rows[2])

    press(rows[2]!, 'ArrowUp')
    press(rows[1]!, 'ArrowUp')
    expect(document.activeElement).toBe(rows[0])
    await unmount()
  })

  it('ticks the row the keyboard is on with Space, once per press', async () => {
    const { rows, toggle, unmount } = await list()
    setTabbing(true)
    rows[1]!.focus()

    expect(press(rows[1]!, ' ').prevented).toBe(true)
    expect(toggle).toHaveBeenCalledWith(12)
    // Held, the key repeats: the tick does not flicker.
    press(rows[1]!, ' ', { repeat: true })
    expect(toggle).toHaveBeenCalledTimes(1)

    // From the row's ⋯ too: Space is the row's wherever in it the keyboard is.
    const more = rows[2]!.nextElementSibling as HTMLElement
    more.focus()
    press(more, ' ')
    expect(toggle).toHaveBeenLastCalledWith(13)
    await unmount()
  })

  it('leaves Space to play and pause after a click, and on another list’s rows', async () => {
    const { rows, toggle, unmount } = await list()
    rows[0]!.focus()
    expect(press(rows[0]!, ' ').prevented).toBe(false)

    setTabbing(true)
    const [elsewhere] = drawRows('another-list', [99])
    elsewhere!.focus()
    expect(press(elsewhere!, ' ').prevented).toBe(false)
    expect(press(elsewhere!, 'ArrowDown').prevented).toBe(false)
    expect(toggle).not.toHaveBeenCalled()
    await unmount()
  })

  it('takes Space from play and pause only while the keyboard is on a row', async () => {
    const play = jest.fn()
    const { rows, toggle, unmount } = await list()
    const keys = await renderHook(() => {
      useHotkeys({ ' ': play }, { beforeFocused: true })
    })

    setTabbing(true)
    rows[0]!.focus()
    press(rows[0]!, ' ')
    expect(toggle).toHaveBeenCalledWith(11)
    expect(play).not.toHaveBeenCalled()

    // A click on the row: the ring goes, and Space is play and pause again.
    setTabbing(false)
    press(rows[0]!, ' ')
    expect(play).toHaveBeenCalledTimes(1)
    expect(toggle).toHaveBeenCalledTimes(1)

    await keys.unmount()
    await unmount()
  })

  it('selects every song with ⌘A or Ctrl+A, from anywhere on the page', async () => {
    const { rows, selectAll, unmount } = await list()
    rows[0]!.focus()
    expect(press(rows[0]!, 'a', { metaKey: true }).prevented).toBe(true)
    expect(selectAll).toHaveBeenCalledTimes(1)
    press(document.body, 'A', { ctrlKey: true })
    expect(selectAll).toHaveBeenCalledTimes(2)
    // With Shift, or both, or Alt, it is some other shortcut.
    press(rows[0]!, 'a', { ctrlKey: true, shiftKey: true })
    press(rows[0]!, 'a', { ctrlKey: true, metaKey: true })
    press(rows[0]!, 'a', { metaKey: true, altKey: true })
    expect(selectAll).toHaveBeenCalledTimes(2)
    await unmount()
  })

  it('leaves Ctrl+A to a text field, an open layer, and a list with nothing in it', async () => {
    const { selectAll, unmount } = await list()
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    expect(press(field, 'a', { ctrlKey: true }).prevented).toBe(false)

    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    const item = document.createElement('div')
    item.setAttribute('tabindex', '0')
    menu.append(item)
    document.body.append(menu)
    item.focus()
    expect(press(item, 'a', { ctrlKey: true }).prevented).toBe(false)

    // A popover open over the page, with focus left on the page beneath it.
    openLayer('popover')
    expect(press(document.body, 'a', { ctrlKey: true }).prevented).toBe(false)
    closeLayer('popover')
    expect(selectAll).not.toHaveBeenCalled()
    await unmount()

    const empty = await list([])
    expect(press(document.body, 'a', { ctrlKey: true }).prevented).toBe(false)
    expect(empty.selectAll).toHaveBeenCalledTimes(1)
    await empty.unmount()
  })

  it('stops listening when the page is no longer in front', async () => {
    const { rows, toggle, selectAll, unmount } = await list()
    await unmount()
    setTabbing(true)
    rows[0]!.focus()
    press(rows[0]!, ' ')
    press(document.body, 'a', { ctrlKey: true })
    expect(toggle).not.toHaveBeenCalled()
    expect(selectAll).not.toHaveBeenCalled()
  })
})

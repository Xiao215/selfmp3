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
import { useRowFocus } from './useRowFocus.web'

jest.mock('expo-router', () => ({
  // The page is in front for as long as the hook is mounted.
  useFocusEffect: (effect: () => undefined | (() => void)) => {
    const { useEffect: mockUseEffect } = jest.requireActual<typeof import('react')>('react')
    mockUseEffect(effect, [effect])
  },
}))

/** A control in a row as React Native for web draws it: a button out of Tab's way. */
function control(label: string): HTMLElement {
  const button = document.createElement('div')
  button.setAttribute('role', 'button')
  button.setAttribute('aria-label', label)
  button.setAttribute('tabindex', '-1')
  return button
}

/**
 * A list's rows as the browser has them, between a button before the list and
 * one after it: each row its circle, its press target and its ⋯, every one at
 * `tabindex` -1 as `SongRow` renders them. What is returned is the press
 * targets.
 */
function drawRows(listKey: string, songIds: readonly number[]): HTMLElement[] {
  const grid = document.createElement('div')
  grid.setAttribute('role', 'grid')
  const targets = songIds.map(songId => {
    const row = document.createElement('div')
    row.setAttribute('role', 'row')
    row.setAttribute('data-song-row', listKey)
    row.setAttribute('data-song-id', String(songId))
    const press = control(`Song ${songId}`)
    press.setAttribute('data-row-press', 'true')
    const more = control(`More actions for ${songId}`)
    more.setAttribute('data-row-more', 'true')
    row.append(control(`Select ${songId}`), press, more)
    grid.append(row)
    return press
  })
  document.body.append(grid)
  return targets
}

/** The press targets of a list that Tab would stop on. */
function stops(targets: readonly HTMLElement[]): HTMLElement[] {
  return targets.filter(target => target.tabIndex === 0)
}

/** A row's ⋯, from its press target. */
function moreOf(target: HTMLElement): HTMLElement {
  return target.nextElementSibling as HTMLElement
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
    const more = moreOf(rows[2]!)
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

  /** What Tab's own default does next, after the list's say on where it may land. */
  const afterTab = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

  it('is one Tab stop: the first row, then the row the keyboard was last on', async () => {
    const { rows, unmount } = await list()
    const before = document.createElement('button')
    document.body.prepend(before)
    before.focus()

    // Nothing in a row takes Tab until Tab is pressed, and then only one row's target.
    expect(stops(rows)).toEqual([])
    press(before, 'Tab')
    expect(stops(rows)).toEqual([rows[0]])

    // The keyboard moves to the third row; Tab out and back comes in there.
    rows[0]!.focus()
    press(rows[0]!, 'ArrowDown')
    press(rows[1]!, 'ArrowDown')
    expect(document.activeElement).toBe(rows[2])
    before.focus()
    press(before, 'Tab')
    expect(stops(rows)).toEqual([rows[2]])

    // A click counts as much as the keyboard does.
    rows[1]!.focus()
    before.focus()
    press(before, 'Tab', { shiftKey: true })
    expect(stops(rows)).toEqual([rows[1]])
    await unmount()
  })

  it('lets Tab and Shift+Tab out of the list from anywhere in a row', async () => {
    const { rows, unmount } = await list()
    rows[1]!.focus()
    press(document.body, 'Tab')
    expect(stops(rows)).toEqual([rows[1]])

    // From the row's ⋯, nothing in the list is a stop for this one press, so
    // the browser's Tab goes past the list rather than back to the row.
    const more = moreOf(rows[1]!)
    more.focus()
    press(more, 'Tab', { shiftKey: true })
    expect(stops(rows)).toEqual([])
    // Once it has gone, the row it left is the way back in.
    await afterTab()
    expect(stops(rows)).toEqual([rows[1]])
    await unmount()
  })

  it('comes in on the first row when the one it was on is no longer drawn', async () => {
    const { rows, unmount } = await list()
    rows[2]!.focus()
    rows[2]!.closest('[role="row"]')!.remove()
    press(document.body, 'Tab')
    expect(stops(rows)).toEqual([rows[0]])
    await unmount()
  })

  it('moves along a row’s own controls with ← and →, and no further', async () => {
    const { rows, unmount } = await list()
    const row = rows[1]!.closest('[role="row"]')!
    const [circle, target, more] = Array.from(row.children) as HTMLElement[]
    target!.focus()

    expect(press(target!, 'ArrowRight').prevented).toBe(true)
    expect(document.activeElement).toBe(more)
    expect(tabbing()).toBe(true)
    press(more!, 'ArrowRight')
    expect(document.activeElement).toBe(more)

    press(more!, 'ArrowLeft')
    press(target!, 'ArrowLeft')
    expect(document.activeElement).toBe(circle)
    press(circle!, 'ArrowLeft')
    expect(document.activeElement).toBe(circle)

    // ↓ from a control goes to the next row itself.
    press(circle!, 'ArrowDown')
    expect(document.activeElement).toBe(rows[2])
    await unmount()
  })

  it('gives the row its focus back when the control Enter pressed goes', async () => {
    const { rows, unmount } = await list()
    // A row's ▶: pressed, its song plays and it is drawn no more.
    const play = control('Play 11')
    rows[0]!.before(play)
    play.addEventListener('keydown', event => {
      if ((event as KeyboardEvent).key === 'Enter') play.remove()
    })
    play.focus()
    press(play, 'Enter')
    await new Promise(resolve => setTimeout(resolve))
    expect(document.activeElement).toBe(rows[0])

    // A control that stays keeps its focus.
    const more = moreOf(rows[1]!)
    more.focus()
    press(more, 'Enter')
    await new Promise(resolve => setTimeout(resolve))
    expect(document.activeElement).toBe(more)
    await unmount()
  })

  it('opens the row’s menu from its ⋯ with Shift+F10', async () => {
    const { rows, unmount } = await list()
    const more = moreOf(rows[0]!)
    const clicked = jest.fn()
    more.addEventListener('click', clicked)
    rows[0]!.focus()
    expect(press(rows[0]!, 'F10', { shiftKey: true }).prevented).toBe(true)
    expect(clicked).toHaveBeenCalledTimes(1)
    // Elsewhere it is not the list's.
    expect(press(document.body, 'F10', { shiftKey: true }).prevented).toBe(false)
    await unmount()
  })

  it('gives a row its focus back when it is drawn again after scrolling away', async () => {
    const { rows, unmount } = await list()
    const listKey = rows[0]!.closest('[data-song-row]')!.getAttribute('data-song-row')!
    // The row's half, as a `SongRow` mounts it.
    const drawn = await renderHook(() => useRowFocus(listKey, 12))
    setTabbing(true)
    rows[1]!.focus()

    // Scrolled out of the drawn rows: the row goes, and its focus with it.
    await drawn.unmount()
    const row = rows[1]!.closest('[role="row"]')!
    const parent = row.parentElement!
    row.remove()
    expect(document.activeElement).toBe(document.body)

    // Scrolled back: the row is drawn again, and has the keyboard again.
    parent.insertBefore(row, parent.children[1] ?? null)
    const again = await renderHook(() => useRowFocus(listKey, 12))
    expect(document.activeElement).toBe(rows[1])
    await again.unmount()

    // Not when something else took focus meanwhile.
    rows[1]!.focus()
    const third = await renderHook(() => useRowFocus(listKey, 12))
    await third.unmount()
    row.remove()
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    parent.insertBefore(row, parent.children[1] ?? null)
    const fourth = await renderHook(() => useRowFocus(listKey, 12))
    expect(document.activeElement).toBe(field)
    await fourth.unmount()
    await unmount()
  })

  it('picks the arrows up from the first row in view after the focused row went', async () => {
    const { rows, unmount } = await list()
    const listKey = rows[0]!.closest('[data-song-row]')!.getAttribute('data-song-row')!
    const drawn = await renderHook(() => useRowFocus(listKey, 13))
    rows[2]!.focus()
    await drawn.unmount()
    rows[2]!.closest('[role="row"]')!.remove()

    expect(press(document.body, 'ArrowDown').prevented).toBe(true)
    expect(document.activeElement).toBe(rows[0])
    // With focus somewhere, an arrow on the page is the page's again.
    expect(press(document.body, 'ArrowDown').prevented).toBe(false)
    await unmount()
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

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useLayerFocus, useLayerKeys } from './layerFocus.web'

/*
 * A modal layer in a browser: focus goes in as it opens and back as it
 * closes, Tab goes round it, and a menu's arrows walk its items. Drawn with
 * react-dom over jsdom — the hooks are a browser's, not React Native's.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  // jsdom lays nothing out: everything drawn counts as on screen.
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

/** The one layer a test draws at a time: where its hooks find its node. */
const layerNode: { current: HTMLDivElement | null } = { current: null }

function Layer({ modal, children }: { modal: boolean; children?: ReactNode }): ReactNode {
  useLayerFocus(layerNode, modal)
  useLayerKeys(() => (modal ? layerNode.current : null))
  return createElement('div', { ref: layerNode, 'data-testid': 'layer' }, children)
}

function Page({ open, items }: { open: boolean; items: ReactNode }): ReactNode {
  return createElement(
    'div',
    null,
    createElement('button', { id: 'opener' }, 'Open'),
    createElement('button', { id: 'after' }, 'After'),
    open ? createElement(Layer, { modal: true }, items) : null,
  )
}

const menu = (): ReactNode => [
  createElement('div', { key: 'a', role: 'menuitem', tabIndex: 0, id: 'a' }, 'Play'),
  createElement('div', { key: 'b', role: 'menuitem', tabIndex: 0, id: 'b' }, 'Tags'),
  createElement('div', { key: 'c', role: 'menuitem', tabIndex: 0, id: 'c' }, 'Remove'),
]

const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

function press(key: string, init: KeyboardEventInit = {}): void {
  const target = document.activeElement ?? document.body
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    )
  })
}

describe('a modal layer’s focus', () => {
  it('goes to its first item as it opens, and back to what opened it as it closes', () => {
    act(() => root.render(createElement(Page, { open: false, items: menu() })))
    byId('opener').focus()
    act(() => root.render(createElement(Page, { open: true, items: menu() })))
    expect(document.activeElement?.id).toBe('a')
    act(() => root.render(createElement(Page, { open: false, items: menu() })))
    expect(document.activeElement?.id).toBe('opener')
  })

  it('goes back while the layer is still drawn on its way out', () => {
    // A popover stays drawn while it fades: React's own focus keeping must
    // not hand focus back to the option that was chosen in it.
    const Fading = ({ modal }: { modal: boolean }): ReactNode =>
      createElement(
        'div',
        null,
        createElement('button', { id: 'opener' }, 'Sort by'),
        createElement(Layer, { modal }, menu()),
      )
    act(() => root.render(createElement(Fading, { modal: false })))
    byId('opener').focus()
    act(() => root.render(createElement(Fading, { modal: true })))
    expect(document.activeElement?.id).toBe('a')
    act(() => root.render(createElement(Fading, { modal: false })))
    expect(document.activeElement?.id).toBe('opener')
  })

  it('gives focus to the row in its place when the row that opened it has gone', () => {
    // A song list's rows as SongRow draws them on the web: a row, and its press target.
    const Rows = ({ songs, open }: { songs: readonly string[]; open: boolean }): ReactNode =>
      createElement(
        'div',
        null,
        songs.map(song =>
          createElement(
            'div',
            { key: song, 'data-song-row': 'list' },
            createElement('div', { id: song, 'data-row-press': 'true', tabIndex: -1 }, song),
          ),
        ),
        open ? createElement(Layer, { modal: true }, menu()) : null,
      )
    act(() => root.render(createElement(Rows, { songs: ['one', 'two', 'three'], open: false })))
    byId('two').focus()
    act(() => root.render(createElement(Rows, { songs: ['one', 'two', 'three'], open: true })))
    expect(document.activeElement?.id).toBe('a')
    // Deleted while its confirmation was up, then the confirmation closes.
    act(() => root.render(createElement(Rows, { songs: ['one', 'three'], open: true })))
    act(() => root.render(createElement(Rows, { songs: ['one', 'three'], open: false })))
    expect(document.activeElement?.id).toBe('three')

    // The last row gone: the one before it.
    act(() => root.render(createElement(Rows, { songs: ['one', 'three'], open: true })))
    act(() => root.render(createElement(Rows, { songs: ['one'], open: true })))
    act(() => root.render(createElement(Rows, { songs: ['one'], open: false })))
    expect(document.activeElement?.id).toBe('one')
  })

  it('passes over a dim that is a button but no Tab stop', () => {
    const form = [
      createElement('button', { key: 'dim', id: 'dim', tabIndex: -1 }, 'Close'),
      createElement('input', { key: 'name', id: 'name' }),
    ]
    act(() => root.render(createElement(Page, { open: true, items: form })))
    expect(document.activeElement?.id).toBe('name')
  })

  it('goes to a menu’s first item, past what heads the menu', () => {
    const songMenu = createElement(
      'div',
      { role: 'menu' },
      createElement('button', { id: 'heart' }, 'Like'),
      createElement('div', { role: 'menuitem', tabIndex: 0, id: 'first' }, 'Play next'),
    )
    act(() => root.render(createElement(Page, { open: true, items: songMenu })))
    expect(document.activeElement?.id).toBe('first')
  })

  it('goes to the chosen option of a list of choices', () => {
    const options = [
      createElement('div', {
        key: 'x',
        role: 'option',
        'aria-selected': false,
        tabIndex: 0,
        id: 'x',
      }),
      createElement('div', {
        key: 'y',
        role: 'option',
        'aria-selected': true,
        tabIndex: 0,
        id: 'y',
      }),
    ]
    act(() => root.render(createElement(Page, { open: true, items: options })))
    expect(document.activeElement?.id).toBe('y')
  })

  it('leaves a field that focused itself, and still gives focus back to the opener', () => {
    const field = createElement('input', { key: 'f', id: 'field', autoFocus: true })
    act(() => root.render(createElement(Page, { open: false, items: field })))
    byId('opener').focus()
    act(() => root.render(createElement(Page, { open: true, items: field })))
    expect(document.activeElement?.id).toBe('field')
    act(() => root.render(createElement(Page, { open: false, items: field })))
    expect(document.activeElement?.id).toBe('opener')
  })

  it('stays where a click on the page put it', () => {
    act(() => root.render(createElement(Page, { open: true, items: menu() })))
    byId('after').focus()
    act(() => root.render(createElement(Page, { open: false, items: menu() })))
    expect(document.activeElement?.id).toBe('after')
  })
})

describe('a modal layer’s keys', () => {
  it('takes Tab round the layer rather than out into the page', () => {
    act(() => root.render(createElement(Page, { open: true, items: menu() })))
    byId('c').focus()
    press('Tab')
    expect(document.activeElement?.id).toBe('a')
    press('Tab', { shiftKey: true })
    expect(document.activeElement?.id).toBe('c')
  })

  it('walks a menu’s items with the arrows, wrapping, and Home and End', () => {
    act(() => root.render(createElement(Page, { open: true, items: menu() })))
    press('ArrowDown')
    expect(document.activeElement?.id).toBe('b')
    press('ArrowUp')
    press('ArrowUp')
    expect(document.activeElement?.id).toBe('c')
    press('Home')
    expect(document.activeElement?.id).toBe('a')
    press('End')
    expect(document.activeElement?.id).toBe('c')
  })
})

/**
 * @jest-environment jsdom
 */
// jsdom rather than the React Native environment: the keys are the web's, on
// the field's element and on `window`, where the page's own keys listen.
import { renderHook } from '@testing-library/react-native'
import type { View } from 'react-native'

import { OWNS_SPACE } from '../../shell/keyOwner'
import { FOCUS_OVER, setTabbing } from '../../shell/tabbing'
import { useEscape } from '../../shell/useEscape.web'
import { useHotkeys } from '../../shell/useHotkeys.web'
import { fieldAccess, useFieldFocus, useFieldKeys } from './fieldInput.web'
import type { FieldKey } from './fieldKeys.model'

/**
 * The sound map's field in a browser without a pointer (R7G-1): the keys it
 * takes while it has focus, kept from the page's arrows, Space and Escape,
 * and the ones it leaves them.
 */

/** The field as React Native for web draws it: one Tab stop. */
function drawField(): HTMLElement {
  const field = document.createElement('div')
  field.setAttribute('tabindex', '0')
  field.setAttribute('role', 'application')
  document.body.append(field)
  return field
}

const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  document.body.replaceChildren()
  setTabbing(false)
})

async function listen(answer: (key: FieldKey, shift: boolean) => boolean) {
  const field = drawField()
  const ref = { current: field as unknown as View }
  const key = jest.fn(answer)
  const focus = jest.fn()
  const blur = jest.fn()
  const pan = jest.fn()
  const playPause = jest.fn()
  const escape = jest.fn()
  const hooks = await renderHook(() => {
    useFieldFocus(ref, { key, focus, blur })
    useFieldKeys(pan)
    useHotkeys({ ' ': playPause }, { beforeFocused: true })
    useEscape(true, escape)
  })
  return { field, key, focus, blur, pan, playPause, escape, hooks }
}

describe('the sound map’s keys in a browser', () => {
  it('steps with the arrows it takes, and the map does not move as well', async () => {
    const { field, key, pan, hooks } = await listen(() => true)
    const event = press(field, 'ArrowRight')
    expect(key).toHaveBeenCalledWith({ key: 'arrow', direction: { x: 1, y: 0 } }, false)
    expect(event.defaultPrevented).toBe(true)
    expect(pan).not.toHaveBeenCalled()
    // The keyboard is moving focus: the ring shows.
    expect(document.documentElement.hasAttribute('data-tabbing')).toBe(true)
    await hooks.unmount()
  })

  it('leaves the arrows to move the map when no song is chosen', async () => {
    const { field, pan, hooks } = await listen(key => key.key !== 'arrow')
    press(field, 'ArrowUp')
    expect(pan).toHaveBeenCalledWith({ x: 0, y: -1 })
    await hooks.unmount()
  })

  it('takes Enter, and Shift+Enter as armed', async () => {
    const { field, key, hooks } = await listen(() => true)
    press(field, 'Enter')
    press(field, 'Enter', { shiftKey: true })
    expect(key.mock.calls).toEqual([
      [{ key: 'enter' }, false],
      [{ key: 'enter' }, true],
    ])
    // A held Enter does not play or draw again and again.
    press(field, 'Enter', { repeat: true })
    expect(key).toHaveBeenCalledTimes(2)
    await hooks.unmount()
  })

  it('keeps Enter and Space from the gesture handler, which would take them for a tap', async () => {
    const field = drawField()
    // The gesture handler listens on the field itself, from before the field's own keys.
    const tap = jest.fn()
    field.addEventListener('keydown', tap)
    const hooks = await renderHook(() =>
      useFieldFocus(
        { current: field as unknown as View },
        {
          key: () => true,
          focus: () => undefined,
          blur: () => undefined,
        },
      ),
    )
    press(field, 'Enter')
    press(field, ' ')
    press(field, 'Enter', { altKey: true })
    expect(tap).not.toHaveBeenCalled()
    await hooks.unmount()
  })

  it('takes Space for the song chosen, not for the page’s play and pause', async () => {
    const { field, key, playPause, hooks } = await listen(() => true)
    setTabbing(true)
    field.setAttribute('data-owns-space', OWNS_SPACE.dataSet.ownsSpace)
    press(field, ' ')
    expect(key).toHaveBeenCalledWith({ key: 'enter' }, false)
    expect(playPause).not.toHaveBeenCalled()
    await hooks.unmount()
  })

  it('leaves Space to play and pause when no song is chosen', async () => {
    const { field, playPause, hooks } = await listen(() => true)
    setTabbing(true)
    press(field, ' ')
    expect(playPause).toHaveBeenCalledTimes(1)
    await hooks.unmount()
  })

  it('keeps an Escape it takes from the page, and passes one it does not', async () => {
    let chosen = true
    const { field, escape, hooks } = await listen(key => (key.key === 'escape' ? chosen : true))
    press(field, 'Escape')
    expect(escape).not.toHaveBeenCalled()
    chosen = false
    press(field, 'Escape')
    expect(escape).toHaveBeenCalledTimes(1)
    await hooks.unmount()
  })

  it('zooms with + and −, and leaves ⌘ and Ctrl to the browser', async () => {
    const { field, key, hooks } = await listen(() => true)
    press(field, '+')
    press(field, '-')
    press(field, '=', { metaKey: true })
    expect(key.mock.calls.map(([asked]) => asked)).toEqual([{ key: 'in' }, { key: 'out' }])
    await hooks.unmount()
  })

  it('tells whether the keyboard brought focus, and lets go when focus moves on', async () => {
    const { field, focus, blur, hooks } = await listen(() => true)
    const windowFocused = jest.spyOn(document, 'hasFocus').mockReturnValue(true)
    setTabbing(true)
    field.focus()
    expect(focus).toHaveBeenCalledWith(true)
    field.blur()
    expect(blur).toHaveBeenCalledTimes(1)
    setTabbing(false)
    field.focus()
    expect(focus).toHaveBeenLastCalledWith(false)
    // Another window taking focus keeps the song for when this one comes back.
    windowFocused.mockReturnValue(false)
    field.blur()
    expect(blur).toHaveBeenCalledTimes(1)
    windowFocused.mockRestore()
    await hooks.unmount()
  })
})

describe('the sound map’s field to a browser', () => {
  it('is one Tab stop that runs its keys, and says what they do', () => {
    const access = fieldAccess({ songs: 40, chosen: null, drawing: false }) as Record<
      string,
      unknown
    >
    expect(access['role']).toBe('application')
    expect(access['tabIndex']).toBe(0)
    expect(access['accessibilityLabel']).toMatch(/^Sound map, 40 songs\. The arrow keys/)
    // Its ring is drawn over the sky that covers it.
    expect(access['dataSet']).toEqual(FOCUS_OVER.dataSet)
  })

  it('takes Space while a song is chosen', () => {
    const access = fieldAccess({ songs: 40, chosen: 'Song, Artist', drawing: false })
    expect((access as Record<string, unknown>)['dataSet']).toEqual({
      ...FOCUS_OVER.dataSet,
      ...OWNS_SPACE.dataSet,
    })
  })
})

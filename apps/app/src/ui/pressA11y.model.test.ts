import { describe, expect, it } from 'vitest'

import { ariaFor, spacePresses } from './pressA11y.model'

describe('what a pressable tells a browser', () => {
  it('says a chosen option or tab is selected, and leaves a button’s alone', () => {
    expect(ariaFor('option', { selected: true }, undefined)).toEqual({ 'aria-selected': true })
    expect(ariaFor('tab', { selected: false }, undefined)).toEqual({ 'aria-selected': false })
    // Not every button with a `selected` is a toggle; a toggle says so itself.
    expect(ariaFor('button', { selected: false }, undefined)).toEqual({})
  })

  it('says a link to the page you are on is the current page', () => {
    expect(ariaFor('link', { selected: true }, undefined)).toEqual({ 'aria-current': 'page' })
    expect(ariaFor('link', { selected: false }, undefined)).toEqual({})
  })

  it('says checked only where something is ticked or switched', () => {
    expect(ariaFor('switch', { checked: true }, undefined)).toEqual({ 'aria-checked': true })
    expect(ariaFor('checkbox', { checked: 'mixed' }, undefined)).toEqual({
      'aria-checked': 'mixed',
    })
    expect(ariaFor('button', { checked: true }, undefined)).toEqual({})
  })

  it('says open, busy and unavailable for anything', () => {
    expect(ariaFor('combobox', { expanded: true, busy: false, disabled: true }, undefined)).toEqual(
      {
        'aria-expanded': true,
        'aria-busy': false,
        'aria-disabled': true,
      },
    )
  })

  it('says a value', () => {
    expect(ariaFor('slider', undefined, { min: 0, max: 100, now: 40, text: '40%' })).toEqual({
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': 40,
      'aria-valuetext': '40%',
    })
  })
})

describe('Space', () => {
  it('works a switch, a radio, a tab and a menu’s item, but not a plain button', () => {
    for (const role of ['switch', 'radio', 'tab', 'checkbox', 'menuitem', 'option']) {
      expect(spacePresses(role)).toBe(true)
    }
    // react-native-web's own press responder takes Space on a button.
    expect(spacePresses('button')).toBe(false)
    expect(spacePresses(undefined)).toBe(false)
  })
})

import { fireEvent, render, screen } from '@testing-library/react-native'
import { StyleSheet, Text } from 'react-native'
import type { ViewStyle } from 'react-native'

import { OPACITY } from '../motion.model'
import { Press } from './Press'

/**
 * A touch as Pressability reads it. The release goes through the real
 * responder handlers, so Pressable keeps its own `pressed` and its own
 * let-go timer, as it does on a phone.
 */
function touch(registrationName: string) {
  return {
    nativeEvent: {
      changedTouches: [],
      identifier: 0,
      locationX: 0,
      locationY: 0,
      pageX: 0,
      pageY: 0,
      target: 0,
      timestamp: Date.now(),
      touches: [],
    },
    currentTarget: { measure: () => undefined },
    dispatchConfig: { registrationName },
    persist: () => undefined,
    isDefaultPrevented: () => false,
    isPropagationStopped: () => false,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  }
}

const LIT = '#e4dccb'

function styleOf(testID: string): ViewStyle {
  return StyleSheet.flatten<ViewStyle>(screen.getByTestId(testID).props['style']) ?? {}
}

function backgroundOf(testID: string): unknown {
  return styleOf(testID).backgroundColor
}

const press = (testID: string): Promise<unknown> =>
  fireEvent(screen.getByTestId(testID), 'responderGrant', touch('onResponderGrant'))
const release = (testID: string): Promise<unknown> =>
  fireEvent(screen.getByTestId(testID), 'responderRelease', touch('onResponderRelease'))

describe('Press', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  /**
   * A quick tap: Pressable lets go of `pressed` on a timer that a busy
   * thread holds back, while `onPress` has already run. The look lets go
   * with the tap, not with the timer (Xiao, 2026-10-07: a tag row stayed lit
   * three seconds after its tick went).
   */
  it('lets go of the pressed look as the tap lands, before Pressable’s own timer', async () => {
    const onPress = jest.fn()
    await render(
      <Press
        testID="row"
        depth="row"
        onPress={onPress}
        style={({ pressed }) => [{ padding: 8 }, pressed && { backgroundColor: LIT }]}
      >
        <Text>中文流行</Text>
      </Press>,
    )

    await fireEvent(screen.getByTestId('row'), 'responderGrant', touch('onResponderGrant'))
    expect(backgroundOf('row')).toBe(LIT)

    await fireEvent(screen.getByTestId('row'), 'responderRelease', touch('onResponderRelease'))
    expect(onPress).toHaveBeenCalledTimes(1)
    // Pressable's let-go timer has not run: only `onPress` has.
    expect(backgroundOf('row')).toBeUndefined()
  })

  it('shows the pressed look again on the next press', async () => {
    await render(
      <Press
        testID="row"
        onPress={() => undefined}
        style={({ pressed }) => [pressed && { backgroundColor: LIT }]}
      >
        <Text>jpop</Text>
      </Press>,
    )
    await fireEvent(screen.getByTestId('row'), 'responderGrant', touch('onResponderGrant'))
    await fireEvent(screen.getByTestId('row'), 'responderRelease', touch('onResponderRelease'))
    jest.runOnlyPendingTimers()

    await fireEvent(screen.getByTestId('row'), 'responderGrant', touch('onResponderGrant'))
    expect(backgroundOf('row')).toBe(LIT)
  })

  /*
   * The three looks, each from the one set of values: a sink leaves the
   * Pressable's own style alone (its scale is on the view around it), a
   * wash lays the ink's veil over a bare row, a dim fades bare ink — and
   * each lets go with the tap.
   */
  it('sinks by default, leaving the style it was given as it is', async () => {
    await render(
      <Press testID="tile" onPress={() => undefined} style={{ padding: 8 }}>
        <Text>Evening</Text>
      </Press>,
    )
    await press('tile')
    expect(styleOf('tile')).toEqual({ padding: 8 })
  })

  it('lays a veil over a washed row while it is pressed, over the row’s own style', async () => {
    await render(
      <Press
        testID="row"
        feedback="wash"
        onPress={() => undefined}
        style={({ pressed }) => [{ padding: 8 }, { borderWidth: pressed ? 1 : 0 }]}
      >
        <Text>中文流行</Text>
      </Press>,
    )
    expect(backgroundOf('row')).toBeUndefined()

    await press('row')
    expect(backgroundOf('row')).toEqual(expect.any(String))
    // The caller's own pressed look still comes through underneath.
    expect(styleOf('row')).toMatchObject({ padding: 8, borderWidth: 1 })

    await release('row')
    expect(backgroundOf('row')).toBeUndefined()
  })

  it('fades dimmed ink to the pressed opacity, and back', async () => {
    await render(
      <Press testID="link" feedback="dim" onPress={() => undefined}>
        <Text>Privacy policy</Text>
      </Press>,
    )
    expect(styleOf('link').opacity).toBeUndefined()

    await press('link')
    expect(styleOf('link').opacity).toBe(OPACITY.pressed)

    await release('link')
    expect(styleOf('link').opacity).toBeUndefined()
  })

  it('answers no press while disabled, in any look', async () => {
    const onPress = jest.fn()
    await render(
      <>
        <Press testID="sink" disabled onPress={onPress} />
        <Press testID="wash" feedback="wash" disabled onPress={onPress} />
        <Press testID="dim" feedback="dim" disabled onPress={onPress} />
      </>,
    )
    for (const testID of ['sink', 'wash', 'dim']) {
      await press(testID)
      await release(testID)
      expect(backgroundOf(testID)).toBeUndefined()
      expect(styleOf(testID).opacity).toBeUndefined()
    }
    expect(onPress).not.toHaveBeenCalled()
  })
})

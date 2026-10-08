import { fireEvent, render, screen } from '@testing-library/react-native'
import { StyleSheet, Text } from 'react-native'

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

function backgroundOf(testID: string): unknown {
  return StyleSheet.flatten(screen.getByTestId(testID).props['style'])?.backgroundColor
}

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
})

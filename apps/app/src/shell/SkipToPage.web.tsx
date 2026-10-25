import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Text } from 'react-native'
import type { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { radius, space, type } from '@selfmp3/client'
import { Press } from '../ui/components/Press'
import { Z } from '../ui/surfaces'
import { setTabbing } from './tabbing'

/** What a press can land on, as the browser draws React Native's controls and fields. */
const FOCUSABLE = 'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])'

/**
 * "Skip to the page" (AF1): the first stop of Tab on a computer, out of sight
 * until it has the focus, then a small accent pill over the sidebar's corner.
 * Pressed, it moves the focus to the page's first control, past every row of
 * the sidebar — four pages, each playlist, each tag — that Tab otherwise walks
 * before reaching the page.
 */
export function SkipToPage({ pageRef }: { pageRef: RefObject<View | null> }): ReactNode {
  const [focused, setFocused] = useState(false)
  const skip = (): void => {
    const page = pageRef.current as unknown as HTMLElement | null
    // The page that is showing: a stack keeps the pages under it in the document.
    const first = [...(page?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].find(
      node => node.checkVisibility?.({ visibilityProperty: true }) ?? node.offsetParent !== null,
    )
    if (!first) return
    setTabbing(true)
    first.focus()
  }
  return (
    <Press
      feedback="dim"
      onPress={skip}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      // A button, not a link: react-native-web answers Enter only on a button.
      accessibilityRole="button"
      accessibilityLabel="Skip to the page"
      style={[styles.skip, !focused && styles.away]}
      testID="skip-to-page"
    >
      <Text style={styles.label}>Skip to the page</Text>
    </Press>
  )
}

const styles = StyleSheet.create(theme => ({
  skip: {
    position: 'absolute',
    top: space.sm,
    left: space.snug,
    zIndex: Z.skipLink,
    paddingVertical: 5,
    paddingHorizontal: space.snug,
    borderRadius: radius.coverSm,
    backgroundColor: theme.colors.accent,
  },
  // Out of sight, not out of the way of Tab: a link Tab cannot reach skips nothing.
  away: { opacity: 0, transform: [{ translateY: -60 }] },
  label: { color: theme.colors.onAccent, fontSize: type.sub, fontWeight: '600' },
}))

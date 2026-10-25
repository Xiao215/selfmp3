import type { ReactNode } from 'react'
import { Platform, Text, TextInput, type StyleProp, type TextStyle } from 'react-native'

/**
 * Words you can select part of, to copy a name or a sentence: an Ask answer.
 *
 * React Native's selectable `Text` on iOS offers only Copy, for all of it,
 * with no handles. The system's text view does what Notes does — hold a word,
 * drag the handles, Copy, Look Up, Translate — so on iOS the words are a
 * multiline `TextInput` that cannot be edited, sized to them. Android's
 * selectable `Text` already has handles, and a browser selects anything.
 */
export function SelectableText({
  children,
  style,
  testID,
}: {
  children: string
  style: StyleProp<TextStyle>
  testID?: string
}): ReactNode {
  if (Platform.OS !== 'ios') {
    return (
      <Text style={style} selectable testID={testID}>
        {children}
      </Text>
    )
  }
  return (
    <TextInput
      value={children}
      editable={false}
      multiline
      scrollEnabled={false}
      // A screen reader reads it as the words they are, not as a field.
      accessible
      accessibilityRole="text"
      style={[style, PLAIN]}
      testID={testID}
    />
  )
}

/** A text view's own padding off, so the words sit where a `Text`'s would. */
const PLAIN: TextStyle = { padding: 0, paddingTop: 0, paddingBottom: 0, margin: 0 }

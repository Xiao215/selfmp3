import { useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import type { StyleProp, TextInputProps, ViewStyle } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { HIT_TARGET, iconSize, radius, space, type } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { Search, X } from './Icons'
import { Press } from './Press'

/**
 * The one search field (proposal P1, 2026-10-08): a pill one step up from
 * what it sits on, a magnifier, the words, and a × once there are words to
 * clear. Its edge is clear at rest and turns the accent while it has the
 * focus, as does the magnifier: the focus ring, not a hairline. Search's own
 * page is where it was drawn first, and every other search — a sheet's, the
 * palette's, a panel's — is this one.
 *
 * 48 high with a finger, 40 with a mouse (`useLayoutValue`, `dense`).
 * `raised` is for a field on a card, a sheet or a panel rather than on the
 * page's ground, which would otherwise draw it in the colour it stands on.
 *
 * Given `onPress` and no `value`, it is a **door**: the same pill, its
 * placeholder in place of words, opening the real search somewhere else (Home
 * and Library open Search). A door is not a second place to type.
 *
 * `style` places it in its row (a flex, a width), never its look.
 *
 * Everything a `TextInput` takes passes through; `inputRef` is the input's
 * ref, for a screen that moves the focus itself. `trailing` takes the ×'s
 * place, for something a search may need to offer there instead (Ask's Stop,
 * the palette's count); `null` there means nothing at all.
 */
export function SearchField({
  inputRef,
  raised = false,
  trailing,
  onPress,
  style,
  testID,
  placeholder,
  accessibilityLabel,
  value,
  onChangeText,
  onFocus,
  onBlur,
  ...input
}: Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  inputRef?: Ref<TextInput>
  raised?: boolean
  trailing?: ReactNode
  /** Makes it a door: pressed, it opens the search that is elsewhere. */
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const dense = useLayoutValue(layout => layout.dense)
  const [focused, setFocused] = useState(false)
  const box = [styles.field, dense && styles.fieldDense, raised && styles.fieldRaised]

  if (onPress) {
    return (
      <Press
        depth="control"
        // `style` places the field in its row; the pill itself is the press.
        wrap={style}
        onPress={onPress}
        accessibilityRole="search"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        testID={testID}
        style={({ pressed }) => [box, pressed && styles.doorPressed]}
      >
        <Search size={iconSize.medium} color={theme.colors.textSecondary} />
        <Text style={styles.hint} numberOfLines={1}>
          {placeholder}
        </Text>
      </Press>
    )
  }

  return (
    <View style={[box, style, focused && { borderColor: accent.accent }]}>
      <Search size={iconSize.medium} color={focused ? accent.accent : theme.colors.textSecondary} />
      <TextInput
        ref={inputRef}
        {...input}
        value={value}
        onChangeText={onChangeText}
        onFocus={event => {
          setFocused(true)
          onFocus?.(event)
        }}
        onBlur={event => {
          setFocused(false)
          onBlur?.(event)
        }}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        testID={testID}
        style={styles.input}
      />
      {trailing !== undefined ? (
        trailing
      ) : value && onChangeText ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <X size={iconSize.small} tone="textMuted" />
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 2,
    minHeight: HIT_TARGET + 4,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface1,
    // Clear at rest, the accent while typing: the edge is there for the
    // focus ring alone, and is the fill's own colour until then.
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  /* With a mouse: 40 high, and a little less room inside. */
  fieldDense: { minHeight: 40, paddingHorizontal: space.md },
  // On a card, a sheet or a panel, a field one step up from the ground would
  // be the colour it sits on; it takes the raised control's tone there.
  fieldRaised: { backgroundColor: theme.colors.surface3 },
  doorPressed: { opacity: 0.8 },
  input: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    color: theme.colors.textPrimary,
    fontSize: type.body,
    padding: 0,
    // The edge is the focus ring; the browser's own on top of it drew a
    // second, white outline.
    _web: { outlineStyle: 'none' },
  },
  hint: { flex: 1, minWidth: 0, color: theme.colors.textMuted, fontSize: type.body },
}))

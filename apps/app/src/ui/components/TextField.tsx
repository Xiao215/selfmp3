import { useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { Text, TextInput, View } from 'react-native'
import type { StyleProp, TextInputProps, ViewStyle } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { HIT_TARGET, leading, radius, space, type } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { useAccent } from '../accent'

/**
 * The one text field that is not a search (`SearchField` is that): a name, a
 * code, a link, a key. A control's fill, `radius.field` round, its edge clear
 * at rest and the accent while it has the focus — the focus ring every field
 * had to remember for itself, and five forgot.
 *
 * 48 high with a finger, 40 with a mouse (`dense`), as a search is.
 * `size="small"` is the field in a Settings row, beside the row's words:
 * 36 high and the row's smaller type. `raised` is for a field on a sheet, a
 * popover or a dialog, which are the control surface already, and would
 * otherwise draw it in the colour it stands on.
 *
 * `label` is said above the field and read with it; `hint` is the quiet line
 * under it. `action` sits beside the field on its line — the Rename, Join or
 * Create a name is typed for — so a field and its button are one row
 * everywhere.
 *
 * `limit` is the schema the words are checked against when they are sent
 * (`NameSchema`, `RoomMemberNameSchema`): its longest is the field's
 * `maxLength`, so the field stops where the server would refuse rather than
 * at a number written out beside it. A limit that is not a schema's (a room
 * code's letters and its space) is a plain `maxLength`.
 *
 * `secret` hides what is typed (a key). `disabled` stops typing, for a form
 * whose answer is on its way. Everything else a `TextInput` takes passes
 * through; `style` places the field in its row, never its look.
 */
export function TextField({
  label,
  hint,
  action,
  limit,
  secret = false,
  disabled = false,
  raised = false,
  size = 'regular',
  inputRef,
  style,
  accessibilityLabel,
  placeholder,
  maxLength,
  onFocus,
  onBlur,
  ...input
}: Omit<TextInputProps, 'style' | 'placeholderTextColor' | 'secureTextEntry' | 'editable'> & {
  label?: string
  hint?: ReactNode
  action?: ReactNode
  limit?: { readonly maxLength: number | null }
  secret?: boolean
  disabled?: boolean
  raised?: boolean
  size?: 'regular' | 'small'
  inputRef?: Ref<TextInput>
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const dense = useLayoutValue(layout => layout.dense)
  const [focused, setFocused] = useState(false)
  const small = size === 'small'

  const field = (
    <TextInput
      ref={inputRef}
      autoCorrect={false}
      {...input}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textMuted}
      accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
      secureTextEntry={secret}
      editable={!disabled}
      maxLength={limit?.maxLength ?? maxLength}
      onFocus={event => {
        setFocused(true)
        onFocus?.(event)
      }}
      onBlur={event => {
        setFocused(false)
        onBlur?.(event)
      }}
      style={[
        styles.input,
        small ? styles.inputSmall : dense && styles.inputDense,
        raised && styles.inputRaised,
        disabled && styles.disabled,
        focused && { borderColor: accent.accent },
      ]}
    />
  )

  return (
    <View style={[styles.field, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {action ? (
        <View style={styles.row}>
          {field}
          {action}
        </View>
      ) : (
        field
      )}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  field: { gap: 6 },
  label: { color: theme.colors.textSecondary, fontSize: type.sub, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    minHeight: HIT_TARGET + 4,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.field,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    // A control on a card, a sheet or a panel, one step up from it.
    backgroundColor: theme.colors.surface2,
    // Clear at rest, the accent while typing: the edge is there for the
    // focus ring alone, and is the fill's own colour until then.
    borderWidth: 1.5,
    borderColor: 'transparent',
    // The edge is the focus ring; the browser's own on top of it drew a
    // second, white outline.
    _web: { outlineStyle: 'none' },
  },
  /* With a mouse: 40 high, and a little less room inside. */
  inputDense: { minHeight: 40, paddingHorizontal: space.md },
  /* In a Settings row, beside its words. */
  inputSmall: {
    minHeight: 36,
    minWidth: 220,
    paddingHorizontal: 14,
    paddingVertical: 6,
    fontSize: type.sub,
  },
  inputRaised: { backgroundColor: theme.colors.surface3 },
  disabled: { opacity: 0.6 },
  hint: { color: theme.colors.textMuted, fontSize: type.small, lineHeight: leading.small },
}))

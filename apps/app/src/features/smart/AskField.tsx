import { useImperativeHandle, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the dock is its own field, its send turning into Stop in place, as ChangeField's does
import { Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { ASK_TEXT_MAX } from '@selfmp3/shared'
import { iconSize, radius, space, type } from '@selfmp3/client'
import { useAccent } from '../../ui/accent'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronRight, Sparkle, X } from '../../ui/components/Icons'
import { NO_AUTOFILL } from '../../ui/noAutofill'
import { floating } from '../../ui/surfaces'
import { StopButton } from './StopButton'

/** The field's words, read and written by the page: Stop puts a question back. */
export interface DraftHandle {
  read: () => string
  write: (words: string) => void
}

/**
 * The field at the foot of the page: one line with a send once there are
 * words, and while an answer is worked on, a Stop where the send was. Enter
 * sends; a browser keeps the focus in it, since the next follow-up is likely.
 *
 * After a list it wears the list as a chip, "↳ these 19 songs" (B1,
 * 2026-10-26): what "these" means, the list sent as what is on the screen.
 * Its ×, or ⌫ in the empty field, lets the list go, and the words are asked
 * with nothing on the screen.
 */
export function AskField({
  inputRef,
  draftRef,
  onTyping,
  onSend,
  onStop,
  chip,
  placeholder,
  autoFocus,
}: {
  inputRef: RefObject<TextInput | null>
  draftRef: RefObject<DraftHandle | null>
  /** Whether anything is typed, each time that changes. */
  onTyping: (typing: boolean) => void
  onSend: (words: string) => void
  /** While an answer is worked on: what Stop does. */
  onStop: (() => void) | null
  /** The list "these" means, and how to let it go. */
  chip: { label: string; name: string; onLetGo: () => void } | null
  placeholder: string
  autoFocus: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const [focused, setFocused] = useState(false)
  const [value, setValue] = useState('')
  const typed = useRef(value)
  const change = (next: string): void => {
    typed.current = next
    setValue(next)
    onTyping(next !== '')
  }
  useImperativeHandle(draftRef, () => ({ read: () => typed.current, write: change }))
  const words = value.trim().length > 0
  return (
    <View style={[styles.field, focused && { borderColor: accent.accent }]}>
      {chip ? (
        <View style={styles.chip} testID="ask-chip" accessibilityLabel={`About ${chip.name}`}>
          <Text style={styles.chipText} numberOfLines={1}>
            {`↳ ${chip.label}`}
          </Text>
          <IconButton
            label="Ask something new instead"
            size={22}
            onPress={() => {
              chip.onLetGo()
              inputRef.current?.focus()
            }}
            testID="ask-chip-let-go"
          >
            <X size={iconSize.tiny} color={theme.colors.textSecondary} />
          </IconButton>
        </View>
      ) : (
        <Sparkle size={iconSize.small} />
      )}
      <TextInput
        {...NO_AUTOFILL}
        ref={inputRef}
        value={value}
        onChangeText={change}
        onSubmitEditing={onStop ? undefined : () => onSend(value)}
        onKeyPress={event => {
          if (chip && event.nativeEvent.key === 'Backspace' && typed.current === '') chip.onLetGo()
        }}
        maxLength={ASK_TEXT_MAX}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        returnKeyType="send"
        submitBehavior="submit"
        blurOnSubmit={false}
        accessibilityLabel="Ask"
        testID="ask-follow-up-input"
        style={styles.input}
      />
      {onStop ? (
        <StopButton onPress={onStop} size={34} testID="ask-stop" />
      ) : (
        <View style={!words && styles.sendAway} pointerEvents={words ? 'auto' : 'none'}>
          <IconButton
            label="Send"
            filled="accent"
            size={34}
            onPress={() => onSend(value)}
            testID="ask-follow-up-send"
          >
            <ChevronRight size={iconSize.field} color={theme.colors.onPrimary} />
          </IconButton>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  field: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: 18,
    paddingRight: space.sm,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.surface3,
    ...floating(theme.colors),
  },
  // Never cut short: "these 18 so…" hid the one thing the chip is there to say.
  chip: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingLeft: space.snug,
    paddingRight: space.xs,
    paddingVertical: space.xs,
    marginLeft: -space.sm,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.accentPill,
  },
  chipText: { color: theme.colors.textPrimary, fontSize: type.small },
  input: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    paddingVertical: space.sm,
  },
  sendAway: { opacity: 0 },
}))

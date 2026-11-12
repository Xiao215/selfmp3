import { useImperativeHandle, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the dock is its own field, its send turning into Stop in place, as ChangeField's does
import { TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { ASK_TEXT_MAX } from '@selfmp3/shared'
import { iconSize, radius, space, type } from '@selfmp3/client'
import { useAccent } from '../../ui/accent'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronRight, Sparkle } from '../../ui/components/Icons'
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
 * It wears nothing of what the words are about: Ask works that out from the
 * conversation and the list open beside it, and each reply says what it was
 * made from (2026-11-12, the context shelf left out).
 */
export function AskField({
  inputRef,
  draftRef,
  onTyping,
  onSend,
  onStop,
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
      <Sparkle size={iconSize.small} />
      <TextInput
        {...NO_AUTOFILL}
        ref={inputRef}
        value={value}
        onChangeText={change}
        onSubmitEditing={onStop ? undefined : () => onSend(value)}
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
  input: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    paddingVertical: space.sm,
  },
  sendAway: { opacity: 0 },
}))

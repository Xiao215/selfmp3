import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { SMART_NOTES_MAX } from '@selfmp3/shared'
import { leading, space, type, useSettings, useUpdateSettings } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { showToast } from '../../ui/toast'
import { AnswerActions, AnswerHead, AnswerLine } from './AnswerParts'

/**
 * "From now on, Chinese names only" (docs/features/ai.md, "Remembered
 * preferences"): a way of doing things to keep for every Ask after this one,
 * saved only when you say so. Settings › Smart features lists them, to take
 * one away.
 */
export function RememberAnswer({ note, onDone }: { note: string; onDone: () => void }): ReactNode {
  const { data: settings } = useSettings()
  const update = useUpdateSettings()
  const notes = settings?.smartNotes ?? []
  const saved = notes.some(each => each.toLowerCase() === note.toLowerCase())
  const full = notes.length >= SMART_NOTES_MAX

  const save = (): void => {
    update.mutate(
      { smartNotes: [...notes, note] },
      {
        onSuccess: () => {
          showToast('Ask will remember that', 'good')
          onDone()
        },
      },
    )
  }

  return (
    <View style={styles.body} testID="ask-remember">
      <AnswerHead>Remember this for every Ask?</AnswerHead>
      <Text style={styles.note}>“{note}”</Text>
      <AnswerLine>
        {saved
          ? 'Ask remembers this already.'
          : full
            ? `Ask remembers ${SMART_NOTES_MAX} things already: take one away in Settings › Smart features first.`
            : 'Sent with each request from now on. Settings › Smart features lists what Ask remembers, to take any of it away.'}
      </AnswerLine>
      <AnswerActions>
        <Button label="Not now" onPress={onDone} />
        <Button
          label="Remember"
          variant="primary"
          busy={update.isPending}
          disabled={saved || full || !settings}
          onPress={save}
          testID="ask-remember-save"
        />
      </AnswerActions>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm },
  note: { color: theme.colors.textPrimary, fontSize: type.body, lineHeight: leading.body },
}))

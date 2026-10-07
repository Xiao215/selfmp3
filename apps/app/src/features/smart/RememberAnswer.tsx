import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { SMART_NOTES_MAX } from '@selfmp3/shared'
import { space, useSettings, useUpdateSettings } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { showToast } from '../../ui/toast'

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
      <Text style={styles.head}>Remember this for every Ask?</Text>
      <Text style={styles.note}>“{note}”</Text>
      <Text style={styles.line}>
        {saved
          ? 'Ask remembers this already.'
          : full
            ? `Ask remembers ${SMART_NOTES_MAX} things already: take one away in Settings › Smart features first.`
            : 'Sent with each request from now on. Settings › Smart features lists what Ask remembers, to take any of it away.'}
      </Text>
      <View style={styles.actions}>
        <Button label="Not now" onPress={onDone} />
        <Button
          label="Remember"
          variant="primary"
          busy={update.isPending}
          disabled={saved || full || !settings}
          onPress={save}
          testID="ask-remember-save"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm },
  head: { color: theme.colors.textPrimary, fontSize: 15.5, fontWeight: '600' },
  note: { color: theme.colors.textPrimary, fontSize: 14.5, lineHeight: 21 },
  line: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
}))

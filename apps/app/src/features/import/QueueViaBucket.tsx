import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { failureText, radius, useLibrary, useRequestCloudImport } from '@selfmp3/client'
import { useAccent } from '../../ui/accent'
import { card, sectionTitle } from '../../ui/surfaces'
import { Button } from '../../ui/components/Button'
import { CloudUpload } from '../../ui/components/Icons'
import { TagChooser } from '../../ui/components/TagChooser'

/**
 * Adding a link without the server.
 *
 * The import screen proper needs the server for every step: it reads the link,
 * lists what it holds, plays a song before it is added, and downloads it. That
 * screen is right to want the server, and wrong to be the only way in — a
 * device is not usually beside its server, and "come back when you are" is not
 * an answer to "I have found a song".
 *
 * So the link is written to the bucket instead, with the tags that would have
 * gone with it (an import only ever tags; it never offers a playlist), and the
 * server picks it up the next time it is awake (SYNC.md, rule 6: work a device
 * cannot do waits in the bucket until one that can takes it). It arrives here with the sync after that, and until then
 * it is a row in the library's pending imports.
 *
 * What is lost is the looking, not the importing: nothing here can say what a
 * link holds, or play it first, because only the server can read it at all.
 */
export function QueueViaBucket(): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { data: library } = useLibrary()
  const queue = useRequestCloudImport()

  const [url, setUrl] = useState('')
  const [tagIds, setTagIds] = useState<ReadonlySet<number>>(new Set())
  const [added, setAdded] = useState(false)

  const tags = library?.tags ?? []
  const ready = url.trim().length > 0 && !queue.isPending

  const submit = (): void => {
    if (!ready) return
    queue.mutate(
      {
        url: url.trim(),
        tagIds: [...tagIds],
        playlistId: null,
      },
      {
        onSuccess: () => {
          setAdded(true)
          setUrl('')
          setTagIds(new Set())
        },
      },
    )
  }

  return (
    <View style={styles.card} testID="import-queue-via-bucket">
      <Text style={styles.title} accessibilityRole="header">
        Add it anyway
      </Text>
      <Text style={styles.body}>
        Leave the link here and your library’s computer downloads it the next time it’s on. It shows
        up in your library soon after.
      </Text>

      <TextInput
        style={styles.input}
        value={url}
        onChangeText={text => {
          setUrl(text)
          setAdded(false)
        }}
        placeholder="Paste a link"
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="url"
        onSubmitEditing={submit}
        accessibilityLabel="Link to import"
        testID="queue-url"
      />

      {tags.length > 0 ? (
        <View style={styles.field}>
          <TagChooser tags={tags} selected={tagIds} onChange={setTagIds} />
        </View>
      ) : null}

      {queue.isError ? (
        <Text style={styles.error}>{failureText('That could not be added', queue.error)}</Text>
      ) : null}
      {added ? (
        <Text style={styles.good} accessibilityLiveRegion="polite" testID="queue-added">
          Added. It waits in your library’s pending imports until that computer is on.
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={queue.isPending ? 'Adding…' : 'Add for later'}
          icon={<CloudUpload size={13} color={accent.onAccent} />}
          variant="primary"
          disabled={!ready}
          onPress={submit}
          testID="queue-submit"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  card: {
    ...card(theme.colors),
    marginTop: 16,
    padding: 18,
    gap: 10,
  },
  title: sectionTitle(theme.colors),
  body: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
  // A control on the card: one step up from it, a pill, no edge.
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.pill,
    color: theme.colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  field: { marginTop: 2 },
  error: { color: theme.colors.danger, fontSize: 13 },
  good: { color: theme.colors.good, fontSize: 13 },
  actions: { flexDirection: 'row', marginTop: 4 },
}))

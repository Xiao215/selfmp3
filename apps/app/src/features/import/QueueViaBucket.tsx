import { useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { failureText, useLibrary, useRequestCloudImport, space } from '@selfmp3/client'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { NoticeCard, NoticeText } from '../../ui/components/NoticeCard'
import { StatusLine } from '../../ui/components/StatusLine'
import { TextField } from '../../ui/components/TextField'
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
    <NoticeCard
      title="Add it anyway"
      style={styles.card}
      testID="import-queue-via-bucket"
      actions={
        <Button
          label={queue.isPending ? 'Adding…' : 'Add for later'}
          icon={<CloudUpload size={13} color={accent.onAccent} />}
          variant="primary"
          disabled={!ready}
          onPress={submit}
          testID="queue-submit"
        />
      }
    >
      <NoticeText>
        Leave the link here and your library’s computer downloads it the next time it’s on. It shows
        up in your library soon after.
      </NoticeText>

      <TextField
        value={url}
        onChangeText={text => {
          setUrl(text)
          setAdded(false)
        }}
        placeholder="Paste a link"
        autoCapitalize="none"
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
        <StatusLine>{failureText('That could not be added', queue.error)}</StatusLine>
      ) : null}
      {added ? (
        <StatusLine tone="good" testID="queue-added">
          Added. It waits in your library’s pending imports until that computer is on.
        </StatusLine>
      ) : null}
    </NoticeCard>
  )
}

const styles = StyleSheet.create(() => ({
  // Under the away notice, apart from it as the page's blocks are.
  card: { marginTop: space.lg },
  field: { marginTop: 2 },
}))

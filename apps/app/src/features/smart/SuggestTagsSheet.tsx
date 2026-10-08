import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useQuery } from '@tanstack/react-query'
import { failureText, space, STALE, type } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { Button } from '../../ui/components/Button'
import { Sheet } from '../../ui/components/Sheet'
import { TagsReview } from './TagsReview'
import { Working } from './Working'
import { useSmartServer } from './useSmartServer'
import { reachedConnection, viaKey } from '../../connection/via'

/**
 * Suggest tags, from Tags' untagged card: the tag review (docs/features/ai.md,
 * "Tags") aimed at the songs without a tag. One row per tag, so 99 songs of
 * Mandarin pop are one decision; what your library already says starts
 * ticked, the model's guesses wait for a yes.
 */
export function SuggestTagsSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): ReactNode {
  const server = useSmartServer()
  const via = reachedConnection(server.reach)?.baseUrl ?? null
  const answer = useQuery({
    queryKey: viaKey(via, 'ai', 'tags', 'untagged'),
    queryFn: () => server.api!.untaggedTags(),
    enabled: open && server.api !== null,
    retry: false,
    staleTime: STALE.tenMinutes,
  })

  let body: ReactNode
  if (server.reach.state !== 'reachable') {
    body = <ServerAway reach={server.reach} need="ai" testID="suggest-tags-server" />
  } else if (answer.isPending) {
    body = (
      <Working
        steps={[
          { doing: 'Reading your untagged songs', done: 'Read your untagged songs' },
          { doing: 'Asking about the ones your library can’t place', after: 1500 },
        ]}
        testID="suggest-tags-waiting"
      />
    )
  } else if (answer.error) {
    body = (
      <View style={styles.failed}>
        <Text style={styles.error}>{failureText('Couldn’t suggest tags', answer.error)}</Text>
        <Button label="Try again" onPress={() => void answer.refetch()} />
      </View>
    )
  } else {
    body = <TagsReview review={answer.data} height={440} onClose={onClose} />
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Suggested tags"
      subtitle="For songs without a tag"
      width={640}
      testID="suggest-tags"
    >
      <View style={styles.body}>{body}</View>
    </Sheet>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { padding: space.sm },
  failed: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  error: { color: theme.colors.danger, fontSize: type.small, flexShrink: 1 },
}))

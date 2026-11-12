import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { ShareAskEntry, ShareSummary } from '@selfmp3/shared'
import { radius, space, type } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { RoomFace } from '../room/RoomFace'

/** "Ken asked for 晴天 again", with Share again and Not now (F1). */
export function AskAgainCard({
  ask,
  link,
  onShare,
  onDismiss,
}: {
  ask: ShareAskEntry
  link: Pick<ShareSummary, 'name'>
  onShare: () => void
  onDismiss: () => void
}): ReactNode {
  return (
    <View style={styles.ask} testID={`share-ask-${ask.id}`}>
      <View style={styles.askHead}>
        <RoomFace name={ask.name} colour={1} picture={null} size={24} />
        <Text style={styles.askText} numberOfLines={2}>
          {ask.name} asked for <Text style={styles.strong}>{link.name}</Text> again
        </Text>
      </View>
      <View style={styles.askButtons}>
        <Button label="Share again" variant="primary" onPress={onShare} />
        <Button label="Not now" variant="text" onPress={onDismiss} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  ask: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface2,
  },
  askHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  askText: { flex: 1, minWidth: 0, color: theme.colors.textPrimary, fontSize: type.body },
  strong: { fontWeight: '600' },
  askButtons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
}))

import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { leading, radius, type } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { useConnection } from '../../connection/ConnectionProvider'
import { useServerDirect } from '../../connection/useServerDirect'
import { useServerSongIds } from '../../connection/useServerSongIds'
import { floating } from '../../ui/surfaces'
import { Dialog, DialogHead } from '../../ui/components/Dialog'
import { MetadataDialog } from './MetadataDialog'
import { reachedConnection } from '../../connection/via'

/**
 * "Fix metadata…", whichever kind of library this device has.
 *
 * The lookup is the server's — it asks iTunes and MusicBrainz, caches their
 * answers for a day, and downloads the cover that is picked — so a cloud
 * library reaches the server directly, the way Import and Stats do, and asks
 * it about the same song under the number *it* uses (`useServerSongIds`).
 *
 * The button is on the details panel either way. Hiding it when the server is
 * off, which is what this replaces, said "this library cannot have its
 * metadata fixed" rather than "your server is not answering".
 */
export function FixMetadata({ song, onClose }: { song: Song; onClose: () => void }): ReactNode {
  const { fromCloud } = useConnection()
  if (!fromCloud) return <MetadataDialog song={song} askFor={song.id} onClose={onClose} />
  return <CloudFix song={song} onClose={onClose} />
}

function CloudFix({ song, onClose }: { song: Song; onClose: () => void }): ReactNode {
  const reach = useServerDirect()
  const via = reachedConnection(reach)
  const ids = useServerSongIds(via)
  const askFor = via ? ids.onServer(song.id) : undefined

  if (via && askFor !== undefined) {
    return <MetadataDialog song={song} askFor={askFor} via={via} onClose={onClose} />
  }
  if (via && ids.ready) return <NotOnServer onClose={onClose} />
  // Reached, with the two libraries' ids still on their way: still looking, not
  // away — saying the server had never announced an address would be a lie.
  const state = via ? { state: 'looking' as const, lookAgain: reach.lookAgain } : reach
  return <AwayDialog reach={state} onClose={onClose} />
}

/**
 * Reached, but the two libraries cannot line this song up: the server has no
 * song under its uid. Almost always a song imported from another device that
 * this server has not taken down from the bucket yet.
 */
function NotOnServer({ onClose }: { onClose: () => void }): ReactNode {
  return (
    <Shell onClose={onClose} testID="metadata-not-on-server">
      <Text style={styles.cardTitle} accessibilityRole="header">
        Not ready to look up yet
      </Text>
      <Text style={styles.cardBody}>
        The lookup reads the song’s file on your library’s computer. This one came from another
        device and that computer hasn’t fetched it yet — it will, and then this works.
      </Text>
    </Shell>
  )
}

function AwayDialog({
  reach,
  onClose,
}: {
  reach: ReturnType<typeof useServerDirect>
  onClose: () => void
}): ReactNode {
  return (
    <Shell onClose={onClose} testID="metadata-server">
      <ServerAway reach={reach} need="metadata" testID="metadata-server" />
    </Shell>
  )
}

/** The dialog "Fix metadata…" opens into when there is nothing to look up with. */
function Shell({
  onClose,
  testID,
  children,
}: {
  onClose: () => void
  testID: string
  children: ReactNode
}): ReactNode {
  return (
    <Dialog onDismiss={onClose} label="Fix song info" testID={testID} style={styles.dialog}>
      <DialogHead title="Fix song info" onClose={onClose} style={styles.head} />
      <View style={styles.body}>{children}</View>
    </Dialog>
  )
}

const styles = StyleSheet.create(theme => ({
  dialog: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: theme.colors.surface1,
    borderRadius: radius.sheet,
    overflow: 'hidden',
    ...floating(theme.colors),
  },
  head: {
    paddingTop: 16,
    paddingRight: 14,
    paddingBottom: 4,
    paddingLeft: 22,
  },
  body: { paddingTop: 4, paddingHorizontal: 22, paddingBottom: 22, gap: 8 },
  cardTitle: {
    color: theme.colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
    marginTop: 16,
  },
  cardBody: { color: theme.colors.textSecondary, fontSize: type.sub, lineHeight: leading.sub },
}))

import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { oklchToHexAlpha, radius, space } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { useConnection } from '../../connection/ConnectionProvider'
import { useServerDirect } from '../../connection/useServerDirect'
import { useServerSongIds } from '../../connection/useServerSongIds'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useAccent } from '../../ui/accent'
import { IconButton } from '../../ui/components/IconButton'
import { X } from '../../ui/components/Icons'
import { MetadataDialog } from './MetadataDialog'

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
  const via = reach.state === 'reachable' ? reach.connection : undefined
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
        Your server doesn’t have this song
      </Text>
      <Text style={styles.cardBody}>
        The lookup runs there, on the file itself. This one reached your library from another device
        and your server hasn’t taken it down from the bucket yet — it will, and then this works.
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
  const { theme } = useUnistyles()
  const accent = useAccent()
  useEscape(true, onClose, { layer: true })

  useOverlay(
    <View
      style={[styles.backdrop, { backgroundColor: oklchToHexAlpha(0.1, 0.02, accent.hue, 0.6) }]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={styles.dialog}
        role="dialog"
        aria-modal
        accessibilityLabel="Fix metadata"
        accessibilityViewIsModal
        testID={testID}
      >
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            Fix metadata
          </Text>
          <IconButton onPress={onClose} label="Close">
            <X size={16} color={theme.colors.textSecondary} />
          </IconButton>
        </View>
        <View style={styles.body}>{children}</View>
      </View>
    </View>,
    true,
  )

  return null
}

const styles = StyleSheet.create(theme => ({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
    paddingRight: 14,
    paddingBottom: 12,
    paddingLeft: 20,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: '600' },
  body: { paddingTop: 4, paddingHorizontal: 20, paddingBottom: 20, gap: 8 },
  cardTitle: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600', marginTop: 16 },
  cardBody: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
}))

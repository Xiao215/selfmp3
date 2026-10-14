import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { artistOr } from '@selfmp3/shared'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { X } from '../../ui/components/Icons'
import { SongLine } from '../../ui/components/SongLine'
import { RoomFace } from './RoomFace'
import { OPACITY } from '../../ui/motion.model'
import { coverSize, iconSize } from '@selfmp3/client'

/** Whose song it is, as a face on its cover's corner. */
interface Face {
  readonly name: string
  readonly colour: number
  readonly picture: string | null
}

/**
 * A cover with the face of whoever brought the song on its corner: a room's
 * list, a past room, a shared playlist.
 */
function FaceBadge({ face, children }: { face: Face | null; children: ReactNode }): ReactNode {
  return (
    <View>
      {children}
      {face ? (
        <View style={styles.badge}>
          <RoomFace name={face.name} colour={face.colour} picture={face.picture} size={18} ring />
        </View>
      ) : null}
    </View>
  )
}

/**
 * One song in a room or a shared playlist: its cover with whose it is on the
 * corner, the title, "artist · who" under it (and a note: "from a link",
 * "yours"; a room that ended says only the artist), the place's own buttons
 * and, where you may, Take out. A `SongLine`, as every song named outside a
 * list is.
 */
export function RoomEntryLine({
  song,
  uri,
  face,
  who,
  note,
  trailing,
  onRemove,
  onPress,
  dim = false,
  faded = false,
  testID,
}: {
  song: { readonly title: string; readonly artist: string; readonly album?: string | null }
  uri: string | null | undefined
  face: Face | null
  /** Whose it is, in words after the artist; left out where the face on the cover says it. */
  who?: string
  /** After who: "from a link", "yours". */
  note?: string
  trailing?: ReactNode
  onRemove?: () => void
  onPress?: () => void
  /** Played already, in a room's list. */
  dim?: boolean
  /** Can't play here, its buttons still can: a friend's song once the room has ended. */
  faded?: boolean
  testID?: string
}): ReactNode {
  return (
    <SongLine
      style={dim ? styles.dim : undefined}
      faded={faded}
      cover={
        <FaceBadge face={face}>
          <Cover uri={uri} title={song.album || song.title} size={coverSize.line} />
        </FaceBadge>
      }
      title={song.title}
      sub={[artistOr(song.artist), who, note].filter(Boolean).join(' · ')}
      onPress={onPress}
      accessibilityLabel={onPress ? `Play ${song.title}` : undefined}
      testID={testID}
      trailing={
        <>
          {trailing}
          {onRemove ? (
            <IconButton
              label={`Take ${song.title} out`}
              caption="Take out"
              filled
              onPress={onRemove}
            >
              <X size={iconSize.item} tone="textSecondary" />
            </IconButton>
          ) : null}
        </>
      }
    />
  )
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', right: -5, bottom: -5 },
  dim: { opacity: OPACITY.dim },
})

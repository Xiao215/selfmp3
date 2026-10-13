import type { ReactNode } from 'react'
import { useUnistyles } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { isRoomTrackId, useToggleLoved } from '@selfmp3/client'
import { IconButton } from './IconButton'
import { Heart } from './Icons'

/**
 * The song's heart: Like, and Unlike once loved, red and filled while it is.
 * The player bar, Now Playing, a song's page and the song menu each built
 * their own, at three sizes, and two of the four remembered that a friend's
 * song in a room is not yours to like. Here it draws nothing for one.
 *
 * Bare in a row of icons (the player bar); `filled`, on the control surface,
 * where it stands on its own over a page.
 */
export function LikeButton({
  song,
  filled = false,
  size,
}: {
  song: Song
  filled?: boolean
  /** The button's side, where it is not `IconButton`'s own. */
  size?: number
}): ReactNode {
  const { theme } = useUnistyles()
  const toggleLoved = useToggleLoved()
  if (isRoomTrackId(song.id)) return null
  const ink = filled ? theme.colors.textPrimary : theme.colors.textSecondary
  return (
    <IconButton
      onPress={() => toggleLoved.mutate({ id: song.id, loved: !song.loved })}
      label={song.loved ? 'Unlike' : 'Like'}
      active={song.loved}
      filled={filled}
      size={size}
    >
      <Heart
        size={filled ? 20 : 17}
        filled={song.loved}
        color={song.loved ? theme.colors.danger : ink}
      />
    </IconButton>
  )
}

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { isRoomTrackId, useToggleLoved } from '@selfmp3/client'
import { ease, timing } from '../motion'
import { MOVE_MS } from '../motion.model'
import { lightTap } from '../../ports/haptics'
import { useSongColor } from '../useSongColor'
import { IconButton } from './IconButton'
import { Heart } from './Icons'

/**
 * The song's heart: Like, and Unlike once loved, red and filled while it is.
 * The player bar, Now Playing, a song's page and the song menu each built
 * their own, at three sizes, and two of the four remembered that a friend's
 * song in a room is not yours to like. Here it draws nothing for one.
 *
 * Liked, the heart pops — in a little, then past its size and back — and one
 * ring goes out from it in the song's own colour (O1, 2026-10-25), with a
 * light tap on a phone (I2, 2026-10-27). Unliking just turns it back. Under Reduce Motion neither moves: `timing` lands at
 * once, where the heart is its own size and the ring is gone.
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
  // The colour the server read from the cover, or the letter tile's: no cover is read here.
  const { color } = useSongColor(song, null)
  // The heart's keyframes run on an even clock, so the squash is seen; the
  // ring eases out as it goes.
  const [pop] = useState(() => new Animated.Value(1))
  const [ring] = useState(() => new Animated.Value(1))
  const [motion] = useState(() => ({
    heart: {
      transform: [
        {
          scale: pop.interpolate({
            inputRange: [0, 0.3, 0.6, 1],
            outputRange: [1, POP.squash, POP.overshoot, 1],
          }),
        },
      ],
    },
    ring: {
      opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
      transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.9] }) }],
    },
  }))
  if (isRoomTrackId(song.id)) return null
  const ink = filled ? theme.colors.textPrimary : theme.colors.textSecondary
  const heartSize = filled ? 20 : 17
  const press = (): void => {
    const liking = !song.loved
    toggleLoved.mutate({ id: song.id, loved: liking })
    if (!liking) return
    lightTap()
    pop.setValue(0)
    ring.setValue(0)
    timing(pop, 1, MOVE_MS.likePop, undefined, { easing: Easing.linear })
    timing(ring, 1, MOVE_MS.likeRing, undefined, { easing: ease.out })
  }
  return (
    <View>
      <IconButton
        onPress={press}
        label={song.loved ? 'Unlike' : 'Like'}
        active={song.loved}
        filled={filled}
        size={size}
      >
        <PoppingHeart
          size={heartSize}
          style={motion.heart}
          filled={song.loved}
          color={song.loved ? theme.colors.danger : ink}
        />
      </IconButton>
      <View pointerEvents="none" style={styles.ringPlace}>
        <Animated.View
          style={[styles.ring, { borderColor: color }, motion.ring]}
          testID="like-ring"
        />
      </View>
    </View>
  )
}

/**
 * The heart inside the button, scaled by the pop. Sized by its own `size`, so
 * `IconButton` leaves it alone rather than handing the size to the view.
 */
function PoppingHeart({
  size,
  style,
  filled,
  color,
}: {
  size: number
  style: object
  filled: boolean
  color: string
}): ReactNode {
  return (
    <Animated.View style={style}>
      <Heart size={size} filled={filled} color={color} />
    </Animated.View>
  )
}

/** In to this, then out past its size to this, then home. */
const POP = { squash: 0.82, overshoot: 1.22 } as const

/** The ring's side before it grows. */
const RING = 26

const styles = StyleSheet.create({
  // Over the button's middle, whatever its size.
  ringPlace: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { width: RING, height: RING, borderRadius: RING / 2, borderWidth: 2, opacity: 0 },
})

import { useState, type ReactNode } from 'react'
import { Image, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { radius, roomFace } from '@selfmp3/client'
import { initialOf } from './room.model'

/** Someone as a face: their name, their colour, and their Google picture when they signed in. */
interface Person {
  readonly id?: string
  readonly name: string
  readonly colour: number
  readonly picture?: string | null
}

/**
 * A person in a room: a round face in their colour with their initial, or
 * their Google profile picture when they signed in and have one
 * (docs/features/listen-together.md). On a cover's corner it says who brought
 * the song; in a row of them, who is here.
 *
 * A picture keeps a thin ring of their colour around it, since the colour is
 * what ties a face to the songs they brought; one that will not load gives way
 * to the initial.
 */
export function RoomFace({
  name,
  colour,
  picture = null,
  size = 24,
  ring = false,
}: {
  name: string
  colour: number
  picture?: string | null
  size?: number
  /** Drawn with a ring of the ground around it: overlapping its neighbour, or a cover's corner. */
  ring?: boolean
}): ReactNode {
  const face = roomFace(colour)
  // The address that failed, so a new one gets its own chance.
  const [failed, setFailed] = useState<string | null>(null)
  const shown = picture !== null && picture !== failed ? picture : null
  return (
    <View
      accessibilityLabel={name}
      style={[
        styles.face,
        { width: size, height: size, backgroundColor: face.fill },
        ring ? styles.ring : shown !== null && { padding: size >= 32 ? 2 : 1.5 },
      ]}
    >
      {shown !== null ? (
        <Image
          source={{ uri: shown }}
          style={styles.picture}
          onError={() => setFailed(shown)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text
          style={[styles.letter, { color: face.ink, fontSize: Math.round(size * 0.45) }]}
          allowFontScaling={false}
        >
          {initialOf(name)}
        </Text>
      )}
    </View>
  )
}

/** Faces in a row, each over the edge of the one before. */
export function RoomFaces({
  people,
  size = 24,
}: {
  people: readonly Person[]
  size?: number
}): ReactNode {
  return (
    <View style={styles.row} accessibilityLabel={people.map(person => person.name).join(', ')}>
      {people.map((person, index) => (
        <View
          key={person.id ?? `${person.name}-${index}`}
          style={index > 0 && { marginLeft: -size / 4 }}
        >
          <RoomFace
            name={person.name}
            colour={person.colour}
            picture={person.picture ?? null}
            size={size}
            ring={people.length > 1}
          />
        </View>
      ))}
    </View>
  )
}

/**
 * A cover made of people: a room listened in together, on Home's recents, and
 * a shared playlist among your playlists. Up to four faces on the cover's
 * ground, each a quarter of its side, at a cover's corner for its size.
 * Without a size it fills the width it is given, as a grid's tile does, and
 * the faces are a tile's.
 */
export function FacesCover({
  people,
  size,
}: {
  people: readonly Person[]
  size?: number
}): ReactNode {
  const frame =
    size === undefined
      ? styles.fill
      : { width: size, height: size, borderRadius: size >= 96 ? radius.card : radius.cover }
  const face = size === undefined ? 30 : Math.max(16, Math.round(size / 4))
  return (
    <View style={[styles.cover, frame]}>
      <RoomFaces people={people.slice(0, 4)} size={face} />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  cover: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface2,
  },
  fill: { width: '100%', aspectRatio: 1, borderRadius: radius.card },
  face: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2, borderColor: theme.colors.surface1 },
  picture: { width: '100%', height: '100%', borderRadius: 999 },
  letter: { fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center' },
}))

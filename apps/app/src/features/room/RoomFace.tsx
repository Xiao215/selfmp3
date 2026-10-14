import { useState, type ReactNode } from 'react'
import { Image, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { radius, roomFace } from '@selfmp3/client'
import { Cover } from '../../ui/components/Cover'
import { initialOf } from './room.model'

/** Someone as a face: their name, their colour, and their Google picture when they signed in. */
interface Person {
  readonly id?: string
  readonly name: string
  readonly colour: number
  readonly picture?: string | null
}

/** A face this big has room for both rings, and a thicker one of the ground. */
const BIG_FACE = 40

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
        ring && styles.ring,
        ring && size >= BIG_FACE && styles.ringBig,
        // The colour's ring round a picture, where there is room for it beside the ground's.
        shown !== null && (!ring || size >= BIG_FACE) && { padding: size >= 32 ? 2 : 1.5 },
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
  ring = people.length > 1,
}: {
  people: readonly Person[]
  size?: number
  /** Each with a ring of the ground: on by itself where they overlap, or over covers. */
  ring?: boolean
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
            ring={ring}
          />
        </View>
      ))}
    </View>
  )
}

/** A picture behind the faces: its address, and the title its letter is drawn from without one. */
interface Backdrop {
  readonly uri: string | null | undefined
  readonly title: string
}

/** A face's side as a share of the cover's, by how many share the middle: one is big. */
const FACE_SHARE = [0.5, 0.4, 0.33, 0.28]

/**
 * A cover made of people: a room listened in together, on Home's recents, and
 * a shared playlist among your playlists. Up to four faces in the middle,
 * the fewer the bigger, over the songs' covers where it has them — four in a
 * square, as a playlist's cover, or the one — or else the cover's ground.
 * Without a size it fills the width it is given, as a grid's tile does.
 */
export function FacesCover({
  people,
  size,
  covers = [],
}: {
  people: readonly Person[]
  size?: number
  /** The songs' pictures, in order; those with none are left out. */
  covers?: readonly Backdrop[]
}): ReactNode {
  // A tile in a grid is as wide as its cell: measured, for the faces and the covers.
  const [measured, setMeasured] = useState(0)
  const side = size ?? measured
  const frame =
    size === undefined
      ? styles.fill
      : { width: size, height: size, borderRadius: size >= 96 ? radius.card : radius.cover }
  const shown = people.slice(0, 4)
  const face = Math.max(16, Math.round(side * (FACE_SHARE[shown.length - 1] ?? 0.28)))
  // Each picture once: a room that played an album through is not four of its cover.
  const withArt = covers.filter(
    (cover, at) => cover.uri !== null && covers.findIndex(other => other.uri === cover.uri) === at,
  )
  const backdrop = withArt.length >= 4 ? withArt.slice(0, 4) : withArt.slice(0, 1)
  const cell = backdrop.length === 4 ? Math.ceil(side / 2) : side
  return (
    <View
      style={[styles.cover, frame]}
      onLayout={
        size === undefined
          ? event => setMeasured(Math.floor(event.nativeEvent.layout.width))
          : undefined
      }
    >
      {side > 0 && backdrop.length > 0 ? (
        <View style={styles.backdrop}>
          {backdrop.map((cover, at) => (
            <Cover key={at} uri={cover.uri} title={cover.title} size={cell} radius={0} />
          ))}
        </View>
      ) : null}
      {side > 0 ? <RoomFaces people={shown} size={face} ring /> : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  cover: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: theme.colors.surface2,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  fill: { width: '100%', aspectRatio: 1, borderRadius: radius.card },
  face: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2, borderColor: theme.colors.surface1 },
  ringBig: { borderWidth: 3 },
  picture: { width: '100%', height: '100%', borderRadius: 999 },
  letter: { fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center' },
}))

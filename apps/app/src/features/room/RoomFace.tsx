import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { roomFace } from '@selfmp3/client'
import { initialOf } from './room.model'

/**
 * A person in a room: a round face in their colour with their initial
 * (docs/features/listen-together.md). On a cover's corner it says who brought
 * the song; in a row of them, who is here.
 */
export function RoomFace({
  name,
  colour,
  size = 24,
  ring = false,
}: {
  name: string
  colour: number
  size?: number
  /** Drawn with a ring of the ground around it: overlapping its neighbour, or a cover's corner. */
  ring?: boolean
}): ReactNode {
  const face = roomFace(colour)
  return (
    <View
      accessibilityLabel={name}
      style={[
        styles.face,
        { width: size, height: size, backgroundColor: face.fill },
        ring && styles.ring,
      ]}
    >
      <Text
        style={[styles.letter, { color: face.ink, fontSize: Math.round(size * 0.45) }]}
        allowFontScaling={false}
      >
        {initialOf(name)}
      </Text>
    </View>
  )
}

/** Faces in a row, each over the edge of the one before. */
export function RoomFaces({
  people,
  size = 24,
}: {
  people: readonly { readonly id?: string; readonly name: string; readonly colour: number }[]
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
            size={size}
            ring={people.length > 1}
          />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  face: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2, borderColor: theme.colors.surface1 },
  letter: { fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center' },
}))

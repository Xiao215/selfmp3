import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { View as ViewType } from 'react-native'
import { useRouter } from 'expo-router'
import { StyleSheet } from 'react-native-unistyles'
import { plural } from '@selfmp3/shared'
import { iconSize, radius, space, type, useLibrary, useSoundMap } from '@selfmp3/client'
import { usePlayingSongId } from '../../player/PlayerProvider'
import { ChevronRight } from '../../ui/components/Icons'
import { Press } from '../../ui/components/Press'
import { SectionHead } from '../../ui/components/SectionHead'
import { SKY_INK, skyPoints } from './sky.model'
import { SkyLayer } from './SkyLayer'
import { baseOf, boundsOf, fitView, type FieldSize } from './soundMapView.model'

/** The most stars the card draws: enough for the shape of the library, cheap on Home. */
const CARD_STARS = 400
const CARD_HEIGHT = 128

/**
 * Home's way to the Sound map (A1, docs/features/sound-map.md): a small still
 * sky of the whole library, the song playing lit, and a line saying what the
 * map is for. Pressed, the map opens. Not shown until there are songs on the
 * map, so a new library has no empty card.
 *
 * At most a few hundred stars, an even share of every place: the card is a
 * picture of the map's shape, and Home is drawn often.
 */
export function MapCard(): ReactNode {
  const router = useRouter()
  const { data: library } = useLibrary()
  const { data: map } = useSoundMap()
  const playing = usePlayingSongId()
  const [field, setField] = useState<FieldSize | null>(null)
  const pointerRef = useRef<ViewType>(null)

  const songs = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )
  const places = useMemo(
    () => (map?.places ?? []).filter(place => songs.has(place.id)),
    [map, songs],
  )
  const points = useMemo(() => {
    const all = skyPoints(places, songs)
    const every = Math.ceil(all.length / CARD_STARS)
    return every <= 1 ? all : all.filter((_, index) => index % every === 0)
  }, [places, songs])
  const view = useMemo(
    () => (field ? fitView(field, boundsOf(places), { turned: false }) : null),
    [field, places],
  )

  if (places.length === 0) return null
  return (
    <View style={styles.section}>
      <SectionHead title="Sound map" aside={plural(places.length, 'song', 'songs')} />
      <Press
        depth="row"
        onPress={() => router.navigate('/sound-map')}
        accessibilityRole="link"
        accessibilityLabel={`Sound map, ${plural(places.length, 'song', 'songs')}: tap to listen, draw a line to make a list`}
        style={styles.card}
        testID="home-sound-map"
      >
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          onLayout={event =>
            setField({
              width: event.nativeEvent.layout.width,
              height: event.nativeEvent.layout.height,
            })
          }
        >
          {field && view ? (
            <SkyLayer
              field={field}
              view={view}
              settled={view}
              base={baseOf(field)}
              points={points}
              regions={[]}
              lens={null}
              takes={[]}
              stroke={[]}
              playing={playing}
              pulse={null}
              songs={songs}
              pointerRef={pointerRef}
            />
          ) : null}
        </View>
        <View style={styles.words} pointerEvents="none">
          <View style={styles.text}>
            <Text style={styles.title}>Wander your library</Text>
            <Text style={styles.line} numberOfLines={1}>
              Tap to listen, draw a line to make a list
            </Text>
          </View>
          <ChevronRight size={iconSize.item} color={SKY_INK} />
        </View>
      </Press>
    </View>
  )
}

const styles = StyleSheet.create(() => ({
  section: { gap: space.sm },
  card: {
    height: CARD_HEIGHT,
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: '#04050b',
  },
  words: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
  },
  text: { flex: 1, minWidth: 0 },
  title: {
    fontSize: type.body,
    fontWeight: '700',
    color: SKY_INK,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  line: { fontSize: type.small, color: 'rgba(244,245,249,0.78)' },
}))

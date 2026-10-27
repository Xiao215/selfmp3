import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import type { View as ViewType } from 'react-native'
import { useRouter } from 'expo-router'
import { StyleSheet } from 'react-native-unistyles'
import { radius, space, useLibrary, useSoundMap } from '@selfmp3/client'
import { Press } from '../../ui/components/Press'
import { SectionHead } from '../../ui/components/SectionHead'
import { skyPoints } from './sky.model'
import { SkyLayer } from './SkyLayer'
import { baseOf, boundsOf, fitView, stillView, type FieldSize } from './soundMapView.model'

/** The most stars the card draws: enough for the shape of the library, cheap on Home. */
const CARD_STARS = 400
const CARD_HEIGHT = 128

/**
 * Home's way to the Sound map (A1, docs/features/sound-map.md): a small still
 * sky of the whole library under the section's name, nothing over it: the
 * song playing is not marked, since the card is the map's shape, not where
 * you are in it (Xiao, 2026-10-26). Pressed, the map opens. Not shown until there are songs on the
 * map, so a new library has no empty card.
 *
 * At most a few hundred stars, an even share of every place: the card is a
 * picture of the map's shape, and Home is drawn often.
 */
export function MapCard(): ReactNode {
  const router = useRouter()
  const { data: library } = useLibrary()
  const { data: map } = useSoundMap()
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
  const live = useMemo(() => (view ? stillView(view) : null), [view])

  if (places.length === 0) return null
  return (
    <View style={styles.section}>
      <SectionHead title="Sound map" />
      <Press
        depth="row"
        onPress={() => router.navigate('/sound-map')}
        accessibilityRole="link"
        accessibilityLabel="Open the sound map"
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
          {field && view && live ? (
            <SkyLayer
              field={field}
              live={live}
              settled={view}
              base={baseOf(field)}
              points={points}
              regions={[]}
              lens={null}
              takes={[]}
              stroke={[]}
              playing={null}
              lit={null}
              panel={0}
              pulse={null}
              songs={songs}
              pointerRef={pointerRef}
              still
            />
          ) : null}
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
}))

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { formatLongDuration, plural, type MapPlace } from '@selfmp3/shared'
import {
  nearestSongs,
  pathName,
  songsAlongPath,
  space,
  tagRegions,
  type,
  useLibrary,
  useSoundMap,
} from '@selfmp3/client'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { useBottomInset } from '../../shell/bottomInset'
import { setPageFoot } from '../../shell/pageFoot'
import { useLayoutValue } from '../../shell/useLayout'
import { lineSub, pageFrame } from '../../ui/surfaces'
import { Button } from '../../ui/components/Button'
import { EmptyState } from '../../ui/components/EmptyState'
import { IconButton } from '../../ui/components/IconButton'
import { Play, SoundMap, X } from '../../ui/components/Icons'
import { PageHeader } from '../../ui/components/PageHeader'
import { PageLoading } from '../../ui/components/PageLoading'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SoundField } from './SoundField'

/** A drawn path's points closer than this (0–1) are one point. */
const PATH_STEP = 0.004

/**
 * `/sound-map` (docs/features/sound-map.md, N9a): the library as a field of
 * covers placed by how they sound, songs heard as alike together, with the
 * tags tinting where they gather. Press a spot and the songs nearest it play,
 * nearest first, as "Near …". Drag a path from one place to another and the
 * songs along it are lined up to drift between them, with a line at the foot
 * saying what it made and a Play button. Songs not heard yet are left off and
 * counted under the title.
 *
 * From the sidebar and Library's ⋯ on a computer, and Profile on a phone.
 */
export function SoundMapScreen(): ReactNode {
  const wide = useLayoutValue(layout => layout.wide)
  const bottom = useBottomInset()
  const { data: library } = useLibrary()
  const { data: map, isLoading } = useSoundMap()
  const player = usePlayerCommands()
  useEffect(() => () => setPageFoot(0), [])

  const songs = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )
  const tags = useMemo(() => library?.tags ?? [], [library])
  const places = useMemo(
    () => (map?.places ?? []).filter(place => songs.has(place.id)),
    [map, songs],
  )
  const regions = useMemo(() => tagRegions(places, songs, tags), [places, songs, tags])

  const [path, setPath] = useState<readonly MapPlace[]>([])
  const pathRef = useRef<MapPlace[]>([])
  const reach = useRef(0.03)
  const [drift, setDrift] = useState<{ name: string; ids: readonly number[] } | null>(null)

  const onPress = useCallback(
    (spot: MapPlace) => {
      const ids = nearestSongs(places, spot)
      const first = songs.get(ids[0] ?? -1)
      if (!first) return
      pathRef.current = []
      setPath([])
      setDrift(null)
      player.playFrom(ids, 0, {
        source: { kind: 'songs', origin: 'map', name: `Near ${first.title}` },
      })
    },
    [places, songs, player],
  )
  const onPathStart = useCallback((spot: MapPlace) => {
    pathRef.current = [spot]
    setPath([spot])
    setDrift(null)
  }, [])
  const onPathMove = useCallback((spot: MapPlace, within: number) => {
    reach.current = within
    const last = pathRef.current[pathRef.current.length - 1]
    if (last && Math.hypot(spot.x - last.x, spot.y - last.y) < PATH_STEP) return
    pathRef.current = [...pathRef.current, spot]
    setPath(pathRef.current)
  }, [])
  const onPathEnd = useCallback(() => {
    const drawn = pathRef.current
    if (drawn.length < 2) {
      pathRef.current = []
      setPath([])
      return
    }
    const ids = songsAlongPath(places, drawn, reach.current, songs)
    setDrift({ name: pathName(places, drawn, songs, tags), ids })
  }, [places, songs, tags])
  const clearDrift = (): void => {
    pathRef.current = []
    setPath([])
    setDrift(null)
  }
  const playDrift = (): void => {
    if (!drift || drift.ids.length === 0) return
    player.playFrom(drift.ids, 0, { source: { kind: 'songs', origin: 'map', name: drift.name } })
  }

  const unheard = map?.unheard ?? 0
  const subtitle = map
    ? [plural(places.length, 'song', 'songs'), unheard > 0 ? `${unheard} not heard yet` : null]
        .filter(Boolean)
        .join(' · ')
    : undefined

  const driftSeconds = drift
    ? drift.ids.reduce((sum, id) => sum + (songs.get(id)?.duration ?? 0), 0)
    : 0

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={[styles.head, wide ? styles.headWide : styles.headPhone]}>
        <PageHeader
          title="Sound map"
          back={{ to: wide ? '/library' : '/profile', testID: 'sound-map-back' }}
          subtitle={subtitle}
          subtitleTestID="sound-map-count"
          subtitleLoading={isLoading}
        />
      </View>
      <View
        style={[
          styles.body,
          wide ? styles.bodyWide : styles.bodyPhone,
          { paddingBottom: bottom + space.md },
        ]}
      >
        {isLoading && !map ? (
          <PageLoading />
        ) : places.length === 0 ? (
          <EmptyState
            icon={<SoundMap tone="textSecondary" />}
            title="Nothing on the map yet"
            line="Each song is placed once it has been heard."
            testID="sound-map-empty"
          />
        ) : (
          <>
            <SoundField
              places={places}
              songs={songs}
              regions={regions}
              marked={drift?.ids ?? []}
              path={path}
              onPress={onPress}
              onPathStart={onPathStart}
              onPathMove={onPathMove}
              onPathEnd={onPathEnd}
            />
            <View
              style={styles.foot}
              // The toasts rise above the line and its Play rather than cover
              // it (a "Continue from…" did); the chrome under it they clear already.
              onLayout={event => setPageFoot(event.nativeEvent.layout.height + space.md)}
              testID="sound-map-foot"
            >
              {drift ? (
                drift.ids.length > 0 ? (
                  <>
                    <View style={styles.driftWords} testID="sound-map-drift">
                      <Text style={styles.drift} numberOfLines={1}>
                        {drift.name}
                      </Text>
                      <Text style={styles.driftCount}>
                        {plural(drift.ids.length, 'song', 'songs')},{' '}
                        {formatLongDuration(driftSeconds)}
                      </Text>
                    </View>
                    <Button
                      variant="primary"
                      label="Play"
                      icon={<Play tone="onPrimary" />}
                      onPress={playDrift}
                      testID="sound-map-play"
                    />
                  </>
                ) : (
                  <Text style={styles.hint}>No songs along that line</Text>
                )
              ) : (
                <Text style={styles.hint} numberOfLines={2}>
                  {wide
                    ? 'Press to play what’s there · drag to drift between places · scroll to move, pinch to zoom'
                    : 'Tap to play what’s there · drag to drift · two fingers to move and zoom'}
                </Text>
              )}
              {drift ? (
                <IconButton label="Clear the line" onPress={clearDrift} testID="sound-map-clear">
                  <X tone="textSecondary" />
                </IconButton>
              ) : null}
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  head: { paddingBottom: space.md },
  headWide: pageFrame(true),
  headPhone: pageFrame(false),
  body: { flex: 1 },
  bodyWide: { paddingHorizontal: space.gutterWide },
  bodyPhone: { paddingHorizontal: space.sm },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 52,
    paddingTop: space.sm,
    paddingHorizontal: space.sm,
  },
  driftWords: { flex: 1, minWidth: 0 },
  driftCount: lineSub(theme.colors),
  drift: {
    fontSize: type.body,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  hint: { flex: 1, ...lineSub(theme.colors) },
}))
